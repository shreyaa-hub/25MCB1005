import axios from "axios";
import { Log, initLogger } from "../logging_middleware/logger";

const BASE_URL = "http://4.224.186.213/evaluation-service";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJNYXBDbGFpbXMiOnsiYXVkIjoiaHR0cDovLzIwLjI0NC41Ni4xNDQvZXZhbHVhdGlvbi1zZXJ2aWNlIiwiZW1haWwiOiJzaHJleWEuc2luZ2gyMDI1QHZpdHN0dWRlbnQuYWMuaW4iLCJleHAiOjE3Nzg5MzE3MzcsImlhdCI6MTc3ODkzMDgzNywiaXNzIjoiQWZmb3JkIE1lZGljYWwgVGVjaG5vbG9naWVzIFByaXZhdGUgTGltaXRlZCIsImp0aSI6ImFiNGQwOGQ3LWVlMWEtNGU3Mi04NThkLWU1ZTdlOTcyOTkxZiIsImxvY2FsZSI6ImVuLUlOIiwibmFtZSI6InNocmV5YSBzaW5naCIsInN1YiI6IjMyODJiNDVkLThmMzUtNDFkZS1iNzVhLTMyNWU1NzE5NTlmNyJ9LCJlbWFpbCI6InNocmV5YS5zaW5naDIwMjVAdml0c3R1ZGVudC5hYy5pbiIsIm5hbWUiOiJzaHJleWEgc2luZ2giLCJyb2xsTm8iOiIyNW1jYjEwMDUiLCJhY2Nlc3NDb2RlIjoiU2ZGdVdnIiwiY2xpZW50SUQiOiIzMjgyYjQ1ZC04ZjM1LTQxZGUtYjc1YS0zMjVlNTcxOTU5ZjciLCJjbGllbnRTZWNyZXQiOiJYTVNLVHJ1cEthUFJ4eHVCIn0.WFfcwuXkNfjhHP874Y4UmuuNz9xC9GE4X6HcA-ZczKQ";

initLogger(TOKEN);
const headers = { Authorization: `Bearer ${TOKEN}` };

interface Notification {
  ID: string;
  Type: string;
  Message: string;
  Timestamp: string;
}

// weight by type - placement > result > event
function getTypeWeight(type: string): number {
  if (type === "Placement") return 3;
  if (type === "Result") return 2;
  if (type === "Event") return 1;
  return 0;
}

// score = type weight * 1000 + recency in seconds (more recent = higher)
function getScore(notification: Notification): number {
  const typeWeight = getTypeWeight(notification.Type);
  const timestamp = new Date(notification.Timestamp).getTime();
  const recencyScore = timestamp / 1000;
  return typeWeight * 1000000 + recencyScore;
}

async function getTopN(n: number) {
  await Log("backend", "info", "service", `fetching top ${n} priority notifications`);

  const res = await axios.get(`${BASE_URL}/notifications`, { headers });
  const notifications: Notification[] = res.data.notifications;

  await Log("backend", "info", "service", `fetched ${notifications.length} notifications total`);

  // sort by score descending
  const sorted = notifications.sort((a, b) => getScore(b) - getScore(a));

  // take top n
  const topN = sorted.slice(0, n);

  await Log("backend", "info", "service", `returning top ${n} notifications by priority`);

  console.log(`\nTop ${n} Priority Notifications:`);
  console.log("=".repeat(50));
  topN.forEach((n, index) => {
    console.log(`${index + 1}. [${n.Type}] ${n.Message}`);
    console.log(`   ID: ${n.ID}`);
    console.log(`   Time: ${n.Timestamp}`);
    console.log(`   Score: ${getScore(n).toFixed(0)}`);
    console.log("");
  });

  return topN;
}

// run for top 10
getTopN(10).catch(async (err) => {
  await Log("backend", "error", "service", `priority inbox failed: ${err.message}`);
  console.error(err);
});