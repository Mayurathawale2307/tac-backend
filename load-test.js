import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 290,
  duration: "10s",
};

export default function () {
  const res = http.get("http://localhost:4000/api/health");

  check(res, {
    "status is 200": (r) => r.status === 200,
  });
}
