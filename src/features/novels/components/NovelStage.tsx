import type { CSSProperties } from "react";
import { resolveApiAssetUrl } from "../../../shared/api";
import type { NovelScene, NovelStory } from "../../../shared/types/novels";
import { stageFor, usesLayers } from "../layers";

/** Bottom layer: the current full frame, or in layers mode the place's
 * background with sprites standing on it. The background and sprites share one
 * box with the background's proportions, fitted like the artwork itself, so
 * sprites stay on the picture on tall and narrow screens. */
export function NovelStage({ story, scene, speaker, frameUrl }: { story: NovelStory; scene?: NovelScene; speaker: string; frameUrl?: string | null }) {
  if (!usesLayers(story.config) || frameUrl) {
    const url = resolveApiAssetUrl(frameUrl || null);
    return <div className="novel-stage" style={url ? { backgroundImage: `url("${url}")` } : undefined} />;
  }
  const stage = stageFor(story, scene, speaker);
  const asset = scene?.background ? story.backgrounds?.[scene.background] : undefined;
  const url = resolveApiAssetUrl(stage.background || null);
  const anySpeaking = stage.sprites.some((sprite) => sprite.speaking);
  const box = { "--stage-w": asset?.width || story.config.width, "--stage-h": asset?.height || story.config.height, ...(url ? { backgroundImage: `url("${url}")` } : {}) } as CSSProperties;
  return <div className="novel-stage novel-stage-layers">
    <div className="novel-stage-box" style={box}>
      {stage.sprites.length > 0 && <div className="novel-sprites" aria-hidden="true">
        {stage.sprites.map((sprite) => <img key={sprite.characterId} src={resolveApiAssetUrl(sprite.url) || undefined} alt=""
          className={`novel-sprite is-${sprite.slot} ${sprite.cut ? "" : "is-card"} ${anySpeaking && !sprite.speaking ? "is-dimmed" : ""}`} />)}
      </div>}
    </div>
  </div>;
}
