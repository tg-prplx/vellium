import { Router } from "express";
import {
  getExtensionsState,
  normalizeCustomEndpointAdapters,
  normalizeCustomInspectorFields,
  saveCustomEndpointAdapters,
  saveCustomInspectorFields
} from "../services/extensions.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(getExtensionsState());
});

router.get("/inspector-fields", (_req, res) => {
  res.json(getExtensionsState().customInspectorFields);
});

router.put("/inspector-fields", (req, res) => {
  res.json(saveCustomInspectorFields((req.body as { fields?: unknown } | undefined)?.fields ?? req.body));
});

router.post("/inspector-fields/validate", (req, res) => {
  res.json(normalizeCustomInspectorFields((req.body as { fields?: unknown } | undefined)?.fields ?? req.body));
});

router.get("/endpoint-adapters", (_req, res) => {
  res.json(getExtensionsState().customEndpointAdapters);
});

router.put("/endpoint-adapters", (req, res) => {
  res.json(saveCustomEndpointAdapters((req.body as { adapters?: unknown } | undefined)?.adapters ?? req.body));
});

router.post("/endpoint-adapters/validate", (req, res) => {
  res.json(normalizeCustomEndpointAdapters((req.body as { adapters?: unknown } | undefined)?.adapters ?? req.body));
});

export default router;
