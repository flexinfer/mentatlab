import express from "express";
import cors from "cors";
import runsRouter from "./routes/runs";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "orchestrator" });
});

app.use("/runs", runsRouter);

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 7070;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`orchestrator listening on http://localhost:${port}`);
});