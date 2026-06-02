import http from "k6/http";
import { check } from "k6";

export default function () {
  const res = http.get(
    "https://tac-backend-erf1.onrender.com/api/health"
  );

  console.log("STATUS:", res.status);
  console.log("BODY:", res.body);

  check(res, {
    "status is 200": (r) => r.status === 200,
  });
}