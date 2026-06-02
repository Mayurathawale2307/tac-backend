import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 10,
  duration: "10s",
};

export default function () {
  const res = http.get(
    "https://tac-backend-erf1.onrender.com/api/health"
  );

  check(res, {
    "status is 200": (r) => r.status === 200,
  });
}