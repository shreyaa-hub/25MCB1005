import axios from "axios";

const BASE_URL = "http://4.224.186.213/evaluation-service";

let authToken: string = "";

export function initLogger(token: string) {
  authToken = token;
}

export async function Log(
  stack: "backend" | "frontend",
  level: "debug" | "info" | "warn" | "error" | "fatal",
  pkg: string,
  message: string
): Promise<void> {
  try {
    const response = await axios.post(
      `${BASE_URL}/logs`,
      {
        stack: stack,
        level: level,
        package: pkg,
        message: message,
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Log success:", response.data);
  } catch (error: any) {
    console.error("Log failed:", error?.response?.data || error.message);
  }
}