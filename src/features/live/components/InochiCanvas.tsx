import { OfficialInochi2dRuntime } from "@vellium/inochi2d-runtime";
import { useEffect, useRef } from "react";
import { resolveApiAssetUrl } from "../../../shared/api";
import type { InochiParameter } from "../../../shared/types/inochiAvatar";
import type { SequencedLiveAvatarCue } from "../useLiveAvatarControls";

interface InochiCanvasProps {
  modelUrl: string;
  wasmUrl: string;
  parameters: InochiParameter[];
  audioLevel: number;
  phase: "ready" | "listening" | "thinking" | "speaking";
  cue: SequencedLiveAvatarCue | null;
  onError: (message: string) => void;
}

function findParameter(parameters: InochiParameter[], pattern: RegExp, dimensions?: 1 | 2) {
  return parameters.find((parameter) => (!dimensions || parameter.dimensions === dimensions) && pattern.test(parameter.name));
}

function moveTowards(current: number, target: number, speed: number, delta: number) {
  return current + (target - current) * Math.min(1, speed * delta);
}

function clamp(value: number, parameter: InochiParameter, axis: 0 | 1 = 0) {
  return Math.min(Math.max(value, Math.min(parameter.min[axis], parameter.max[axis])), Math.max(parameter.min[axis], parameter.max[axis]));
}

function farEndpoint(parameter: InochiParameter, axis: 0 | 1) {
  return Math.abs(parameter.max[axis] - parameter.defaults[axis]) >= Math.abs(parameter.defaults[axis] - parameter.min[axis])
    ? parameter.max[axis]
    : parameter.min[axis];
}

export function InochiCanvas({ modelUrl, wasmUrl, parameters, audioLevel, phase, cue, onError }: InochiCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef(audioLevel);
  const phaseRef = useRef(phase);
  const cueRef = useRef(cue);

  useEffect(() => { audioRef.current = audioLevel; }, [audioLevel]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { cueRef.current = cue; }, [cue]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let frame = 0;
    let model: OfficialInochi2dRuntime | null = null;
    const abortController = new AbortController();
    let observer: ResizeObserver | null = null;
    let lastTime = performance.now();
    let lastCueSequence = -1;
    let renderFailures = 0;
    let mouth = 0;
    let blink = 0;
    let nextBlinkAt = performance.now() + 1800 + Math.random() * 2600;
    let blinkUntil = 0;
    let targetHead: [number, number] = [0, 0];
    let head: [number, number] = [0, 0];
    const parameterByName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
    const emotionalTargets = new Map<string, [number, number | undefined]>();
    const emotionalValues = new Map<string, [number, number | undefined]>();
    const mouthParameter = findParameter(parameters, /mouth.*(open|shape|phoneme|ah|a\b)/i);
    const blinkParameters = parameters.filter((parameter) => parameter.dimensions === 1 && /eye.*blink|blink.*eye/i.test(parameter.name));
    const headParameter = findParameter(parameters, /head.*(yaw.*pitch|pitch.*yaw|look)/i, 2);

    const resize = () => {
      if (!model) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(2, rect.width);
      const height = Math.max(2, rect.height);
      model.resize(width, height, dpr);
      const bounds = model.modelBounds();
      if (bounds) {
        const modelWidth = bounds.maxX - bounds.minX;
        const modelHeight = bounds.maxY - bounds.minY;
        if (modelWidth > 0 && modelHeight > 0) {
          const scale = Math.min(width / modelWidth, height / modelHeight) * 0.84;
          model.setCameraTransform(
            -(bounds.minX + bounds.maxX) / 2,
            -(bounds.minY + bounds.maxY) / 2,
            scale
          );
        }
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      targetHead = [
        Math.max(-1, Math.min(1, ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2)),
        Math.max(-1, Math.min(1, -((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2))
      ];
    };
    const handlePointerLeave = () => { targetHead = [0, 0]; };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      onError("Inochi2D renderer lost the WebGL context. Reopen Live mode to restore it.");
    };

    const render = (time: number) => {
      if (disposed || !model) return;
      const delta = Math.min(0.05, Math.max(0.001, (time - lastTime) / 1000));
      lastTime = time;
      try {
        const activeCue = cueRef.current;
        if (activeCue && activeCue.sequence !== lastCueSequence) {
          lastCueSequence = activeCue.sequence;
          for (const name of emotionalTargets.keys()) {
            const definition = parameterByName.get(name);
            if (definition) emotionalTargets.set(name, [definition.defaults[0], definition.dimensions === 2 ? definition.defaults[1] : undefined]);
          }
          for (const change of activeCue.parameters || []) {
            const definition = parameterByName.get(change.name);
            if (definition) {
              if (!emotionalValues.has(change.name)) emotionalValues.set(change.name, [definition.defaults[0], definition.dimensions === 2 ? definition.defaults[1] : undefined]);
              emotionalTargets.set(change.name, [change.value, change.y]);
            }
          }
        }

        for (const [name, requested] of emotionalTargets) {
          const parameter = parameterByName.get(name);
          if (!parameter) continue;
          const current = emotionalValues.get(name) || [parameter.defaults[0], parameter.dimensions === 2 ? parameter.defaults[1] : undefined];
          const next: [number, number | undefined] = [
            moveTowards(current[0], requested[0], 7, delta),
            parameter.dimensions === 2 ? moveTowards(current[1] ?? parameter.defaults[1], requested[1] ?? parameter.defaults[1], 7, delta) : undefined
          ];
          emotionalValues.set(name, next);
          if (parameter.dimensions === 2) {
            model.setParameterVector(parameter.name, clamp(next[0], parameter), clamp(next[1] ?? parameter.defaults[1], parameter, 1));
          } else {
            model.setParameterScalar(parameter.name, clamp(next[0], parameter));
          }
        }

        if (headParameter) {
          head = [moveTowards(head[0], targetHead[0], 3.8, delta), moveTowards(head[1], targetHead[1], 3.8, delta)];
          const x = headParameter.defaults[0] + head[0] * (headParameter.max[0] - headParameter.min[0]) * 0.32;
          const y = headParameter.defaults[1] + head[1] * (headParameter.max[1] - headParameter.min[1]) * 0.25;
          model.setParameterVector(headParameter.name, clamp(x, headParameter), clamp(y, headParameter, 1));
        }

        if (time >= nextBlinkAt && time >= blinkUntil) {
          blinkUntil = time + 115;
          nextBlinkAt = time + 2200 + Math.random() * 3600;
        }
        const blinkTarget = time < blinkUntil ? 1 : 0;
        blink = moveTowards(blink, blinkTarget, blinkTarget ? 25 : 16, delta);
        for (const parameter of blinkParameters) {
          const value = parameter.defaults[0] + blink * (parameter.max[0] - parameter.defaults[0]);
          model.setParameterScalar(parameter.name, clamp(value, parameter));
        }

        if (mouthParameter) {
          const speechTarget = phaseRef.current === "speaking" ? Math.min(1, Math.max(0, audioRef.current) * 1.35) : 0;
          mouth = moveTowards(mouth, speechTarget, speechTarget > mouth ? 22 : 12, delta);
          if (mouthParameter.dimensions === 2) {
            const y = mouthParameter.defaults[1] + mouth * (farEndpoint(mouthParameter, 1) - mouthParameter.defaults[1]);
            model.setParameterVector(mouthParameter.name, mouthParameter.defaults[0], clamp(y, mouthParameter, 1));
          } else {
            const value = mouthParameter.defaults[0] + mouth * (farEndpoint(mouthParameter, 0) - mouthParameter.defaults[0]);
            model.setParameterScalar(mouthParameter.name, clamp(value, mouthParameter));
          }
        }

        model.renderFrame(time);
        renderFailures = 0;
      } catch (error) {
        renderFailures += 1;
        if (renderFailures === 4) onError(error instanceof Error ? error.message : "Inochi2D rendering failed");
      }
      frame = requestAnimationFrame(render);
    };

    const start = async () => {
      try {
        const resolvedWasm = resolveApiAssetUrl(wasmUrl) || wasmUrl;
        const resolvedModel = resolveApiAssetUrl(modelUrl) || modelUrl;
        const runtime = await OfficialInochi2dRuntime.create(
          canvas,
          { initialScale: 0.15 },
          new URL(resolvedWasm, window.location.href),
          abortController.signal
        );
        const response = await fetch(resolvedModel, { cache: "force-cache", signal: abortController.signal });
        if (!response.ok) throw new Error(`Inochi2D model request failed (HTTP ${response.status})`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (disposed) {
          runtime.destroy();
          return;
        }
        model = runtime;
        model.loadModel(bytes);
        resize();
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
        frame = requestAnimationFrame(render);
      } catch (error) {
        if (!disposed) onError(error instanceof Error ? error.message : "Could not load the Inochi2D avatar");
      }
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    void start();
    return () => {
      disposed = true;
      abortController.abort();
      cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      try { model?.destroy(); } catch { /* already released by WebAssembly */ }
      model = null;
    };
  }, [modelUrl, onError, parameters, wasmUrl]);

  return <canvas ref={canvasRef} className="inochi2d-canvas" aria-label="Inochi2D avatar" />;
}
