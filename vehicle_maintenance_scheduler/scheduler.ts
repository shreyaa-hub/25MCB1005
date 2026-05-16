import axios from "axios";
import { Log, initLogger } from "../logging_middleware/logger";

const BASE_URL = "http://4.224.186.213/evaluation-service";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJNYXBDbGFpbXMiOnsiYXVkIjoiaHR0cDovLzIwLjI0NC41Ni4xNDQvZXZhbHVhdGlvbi1zZXJ2aWNlIiwiZW1haWwiOiJzaHJleWEuc2luZ2gyMDI1QHZpdHN0dWRlbnQuYWMuaW4iLCJleHAiOjE3Nzg5MzE3MzcsImlhdCI6MTc3ODkzMDgzNywiaXNzIjoiQWZmb3JkIE1lZGljYWwgVGVjaG5vbG9naWVzIFByaXZhdGUgTGltaXRlZCIsImp0aSI6ImFiNGQwOGQ3LWVlMWEtNGU3Mi04NThkLWU1ZTdlOTcyOTkxZiIsImxvY2FsZSI6ImVuLUlOIiwibmFtZSI6InNocmV5YSBzaW5naCIsInN1YiI6IjMyODJiNDVkLThmMzUtNDFkZS1iNzVhLTMyNWU1NzE5NTlmNyJ9LCJlbWFpbCI6InNocmV5YS5zaW5naDIwMjVAdml0c3R1ZGVudC5hYy5pbiIsIm5hbWUiOiJzaHJleWEgc2luZ2giLCJyb2xsTm8iOiIyNW1jYjEwMDUiLCJhY2Nlc3NDb2RlIjoiU2ZGdVdnIiwiY2xpZW50SUQiOiIzMjgyYjQ1ZC04ZjM1LTQxZGUtYjc1YS0zMjVlNTcxOTU5ZjciLCJjbGllbnRTZWNyZXQiOiJYTVNLVHJ1cEthUFJ4eHVCIn0.WFfcwuXkNfjhHP874Y4UmuuNz9xC9GE4X6HcA-ZczKQ";

initLogger(TOKEN);

const headers = { Authorization: `Bearer ${TOKEN}` };

interface Depot {
  ID: number;
  MechanicHours: number;
}

interface Vehicle {
  TaskID: string;
  Duration: number;
  Impact: number;
}

// knapsack algorithm - picks best tasks within mechanic hour budget
function knapsack(vehicles: Vehicle[], budget: number) {
  const n = vehicles.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(budget + 1).fill(0)
  );

  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = vehicles[i - 1];
    for (let w = 0; w <= budget; w++) {
      dp[i][w] = dp[i - 1][w];
      if (Duration <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - Duration] + Impact);
      }
    }
  }

  // backtrack to find which tasks were selected
  const selected: Vehicle[] = [];
  let w = budget;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(vehicles[i - 1]);
      w -= vehicles[i - 1].Duration;
    }
  }

  return { totalImpact: dp[n][budget], selected };
}

async function main() {
  await Log("backend", "info", "service", "starting vehicle maintenance scheduler");

  // fetch depots
  const depotRes = await axios.get(`${BASE_URL}/depots`, { headers });
  const depots: Depot[] = depotRes.data.depots;
  await Log("backend", "info", "service", `fetched ${depots.length} depots`);

  // fetch vehicles
  const vehicleRes = await axios.get(`${BASE_URL}/vehicles`, { headers });
  const vehicles: Vehicle[] = vehicleRes.data.vehicles;
  await Log("backend", "info", "service", `fetched ${vehicles.length} vehicles`);

  // run scheduler for each depot
  for (const depot of depots) {
    await Log("backend", "debug", "service", `processing depot ${depot.ID} with ${depot.MechanicHours} mechanic hours`);

    const result = knapsack(vehicles, depot.MechanicHours);

    console.log(`\nDepot ${depot.ID} - Budget: ${depot.MechanicHours} hours`);
    console.log(`Total Impact Score: ${result.totalImpact}`);
    console.log(`Tasks selected: ${result.selected.length}`);
    result.selected.forEach(v => {
      console.log(`  - TaskID: ${v.TaskID} | Duration: ${v.Duration}h | Impact: ${v.Impact}`);
    });

    await Log("backend", "info", "service", `depot ${depot.ID} scheduled ${result.selected.length} tasks with total impact ${result.totalImpact}`);
  }

  await Log("backend", "info", "service", "vehicle maintenance scheduler completed");
}

main().catch(async (err) => {
  await Log("backend", "error", "service", `scheduler failed: ${err.message}`);
  console.error(err);
});