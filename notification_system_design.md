# Notification System Design

## Stage 1

so the frontend guy needs REST APIs for showing notifications when students log in. here's what i think we need:

**GET /notifications**
gets all notifications for the logged in student
- header: Authorization: Bearer <token>
- response:
{
  "notifications": [
    {
      "id": "uuid",
      "type": "Placement",
      "message": "TCS is hiring",
      "isRead": false,
      "createdAt": "2026-04-22T17:51:30Z"
    }
  ]
}

**PATCH /notifications/:id/read**
marks one specific notification as read
- header: Authorization: Bearer <token>
- response: { "id": "uuid", "isRead": true }

**PATCH /notifications/read-all**
marks everything as read at once
- response: { "message": "all marked as read" }

**DELETE /notifications/:id**
delete a notification
- response: { "message": "deleted" }

**POST /notifications/notify-all**
admin endpoint to blast notification to all students
- body: { "type": "Placement", "message": "Drive tomorrow 10am" }
- response: { "message": "queued" }

for real time i'd use websockets with socket.io. student logs in, socket connection opens, server pushes directly to their room using studentID. no polling, instant updates.

---

## Stage 2

going with PostgreSQL. data is relational - notifications belong to students, fixed types, read status, timestamps. filtering by studentID and isRead constantly is exactly what SQL is good at.

schema:

CREATE TYPE notification_type AS ENUM ('Event', 'Result', 'Placement');

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id INTEGER NOT NULL,
  type notification_type NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

problems at scale:
- no indexes = full table scan every query, terrible at 5M rows
- table never stops growing
- inserting for 50k students one by one is way too slow

fixes:
- composite index on (student_id, is_read, created_at)
- archive anything older than 90 days
- batch inserts

queries i'd write:

-- unread notifications for a student
SELECT id, type, message, created_at
FROM notifications
WHERE student_id = $1 AND is_read = false
ORDER BY created_at DESC;

-- mark all read
UPDATE notifications
SET is_read = true
WHERE student_id = $1 AND is_read = false;

-- filter by type
SELECT * FROM notifications
WHERE student_id = $1 AND type = $2
ORDER BY created_at DESC;

---

## Stage 3

the query they wrote:

SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;

logically fine but at 5M rows with no index postgres does a full table scan every single time. also SELECT * is pulling all columns including heavy text we dont even need.

what i'd change:

SELECT id, type, message, created_at
FROM notifications
WHERE student_id = 1042 AND is_read = false
ORDER BY created_at DESC;

and add:

CREATE INDEX idx_student_unread
ON notifications (student_id, is_read, created_at DESC);

now postgres jumps straight to that student's rows. goes from O(n) scan to O(log n). much faster.

about indexing every column - no that's terrible advice. every index slows down writes because postgres updates all indexes on every insert/update. we have 50k students getting notifications all the time, over indexing will kill write performance. only index what you filter or sort by.

query for placement notifications last 7 days:

SELECT DISTINCT student_id
FROM notifications
WHERE type = 'Placement'
AND created_at >= NOW() - INTERVAL '7 days';

---

## Stage 4

fetching from DB on every page load for every student is killing performance. DB gets hammered, responses slow down.

my fix - redis cache in front of DB:
- first request hits DB, result stored in redis as notifications:<student_id> with 60s TTL
- next requests within 60s come from redis, DB not touched
- new notification arrives - invalidate that student's cache key, next request gets fresh data

tradeoffs:
- response time ~200ms down to ~5ms
- handles traffic spikes fine
- max 60s staleness - acceptable for notifications
- extra infrastructure to manage

also pagination - send 20 at a time not everything at once. combined with redis this works well at scale.

---

## Stage 5

problems with what they wrote:

function notify_all(student_ids, message):
  for student_id in student_ids:
    send_email(student_id, message)
    save_to_db(student_id, message)
    push_to_app(student_id, message)

- completely synchronous, 50k iterations just blocks the server
- send_email fails at student 200? remaining 49800 get nothing, no retry
- email and DB coupled - DB fails after email sent = no record anywhere
- 50k individual inserts is painfully slow

should DB save and email happen together? no. email is unreliable - network, provider limits, timeouts. if we tie DB write to email success and email fails, we lose the record completely. DB write should always go first independently.

redesigned:

function notify_all(student_ids, message):
  // batch insert everything to DB first
  batch_insert_to_db(student_ids, message)
  
  // push to queue
  for student_id in student_ids:
    enqueue({ student_id, message, type: "email" })
    enqueue({ student_id, message, type: "push" })

worker_process(job):
  try:
    if job.type == "email": send_email(job.student_id, job.message)
    if job.type == "push": push_to_app(job.student_id, job.message)
  catch:
    retry(job, max_attempts=3)
    if still failing: log_failure(job)

why this is better:
- all 50k DB records saved instantly upfront
- workers handle emails async, server stays unblocked
- auto retry 3 times on failure
- email failure doesnt touch DB records or push notifications

## Stage 6

built a priority inbox that ranks notifications by type weight and recency.

scoring logic:
- Placement = weight 3, Result = weight 2, Event = weight 1
- score = typeWeight * 1000000 + timestamp in seconds
- higher score = shows up first

this means a recent Placement always beats an older one, and Placements always beat Results which beat Events. new notifications coming in will naturally get higher recency scores so the ranking stays accurate without any extra work.

to maintain top 10 efficiently as new notifications come in - i'd use a min-heap of size 10. every new notification gets scored and compared against the minimum in the heap. if its score is higher, it replaces the min. this keeps it O(log 10) = O(1) effectively, no need to re-sort everything each time.

code is in notification_app_be/priority_inbox.ts