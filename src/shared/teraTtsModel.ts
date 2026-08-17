import { LOCAL_TERATTS_MODEL_REVISION } from "./localModelConfig";

export interface TeraTtsModelFile {
  path: string;
  bytes: number;
  sha256?: string;
}

/**
 * Exact files used by Vellium's distilled TeraTTSv2 runtime. The teacher
 * sampler is intentionally omitted: it adds 256 MB and is not used by the
 * default fast path. All URLs are resolved against the immutable Hub commit.
 */
export const TERA_TTS_MODEL_FILES: readonly TeraTtsModelFile[] = [
  { path: "RUACCENT_NOTICE.txt", bytes: 1_176 },
  { path: "models/duration_predictor.onnx", bytes: 1_572_411, sha256: "15248b4751493fe48543f01164cd9b74d103b4483c63367a01c344442ebf03d8" },
  { path: "models/sampler_distilled_cfg3_8step.onnx", bytes: 256_417_643, sha256: "921a050f19794bf97234ca8ffc0298559eaca466d9f7f3b72ec41dfefb37acc6" },
  { path: "models/text_encoder.onnx", bytes: 27_910_305, sha256: "d59b7911fe9e465988f26bedbf7c34ef9b2c5588d9b0da5f86d41340a3324a12" },
  { path: "models/vocoder.onnx", bytes: 101_416_199, sha256: "d4e4cf9a9b9de8cca28f309c4cb7735327322b5a764ba61dfc3706c3c7942c07" },
  { path: "ruaccent/dictionary/accents.json.gz", bytes: 20_954_156, sha256: "aa460ebba90de00fbbf3d41d121961f605b98667e45efb7920f127473b15515e" },
  { path: "ruaccent/dictionary/omographs.json.gz", bytes: 219_047, sha256: "04a9e81c68d65f65ba493fe0110f99e79087548c2beeec3032e2b66e28706f36" },
  { path: "ruaccent/dictionary/yo_homographs.json.gz", bytes: 5_747 },
  { path: "ruaccent/dictionary/yo_words.json.gz", bytes: 548_914, sha256: "a19fa89a964a0691d9fe4ee384783e3934904891843d8f59a1c480d67947a82a" },
  { path: "ruaccent/nn/nn_accent/big.onnx", bytes: 2_285_217, sha256: "47e69d9ae19f2a82e21b1c70f6a4bbfb1abc5759e98b2e67d009c5e9d7af18c9" },
  { path: "ruaccent/nn/nn_accent/config.json", bytes: 841 },
  { path: "ruaccent/nn/nn_accent/model.onnx", bytes: 803_402, sha256: "4e393144e45626f6f1062a0784ef06f921b97321a8e7b87ac2a09a892286500a" },
  { path: "ruaccent/nn/nn_accent/ort_config.json", bytes: 727 },
  { path: "ruaccent/nn/nn_accent/special_tokens_map.json", bytes: 99 },
  { path: "ruaccent/nn/nn_accent/tokenizer_config.json", bytes: 257 },
  { path: "ruaccent/nn/nn_accent/vocab.txt", bytes: 140 },
  { path: "ruaccent/nn/nn_omograph/turbo3.1/added_tokens.json", bytes: 279_418 },
  { path: "ruaccent/nn/nn_omograph/turbo3.1/config.json", bytes: 723 },
  { path: "ruaccent/nn/nn_omograph/turbo3.1/merges.txt", bytes: 1_213_606 },
  { path: "ruaccent/nn/nn_omograph/turbo3.1/model.onnx", bytes: 359_306_923, sha256: "2cb6a174c4cdb45bd3132b4f7c8a3779fc4b6869863180ed7d0e421bcd453dbd" },
  { path: "ruaccent/nn/nn_omograph/turbo3.1/special_tokens_map.json", bytes: 280 },
  { path: "ruaccent/nn/nn_omograph/turbo3.1/tokenizer.json", bytes: 5_532_343 },
  { path: "ruaccent/nn/nn_omograph/turbo3.1/tokenizer_config.json", bytes: 492 },
  { path: "ruaccent/nn/nn_omograph/turbo3.1/vocab.json", bytes: 1_555_282 },
  { path: "ruaccent/nn/nn_stress_usage_predictor/config.json", bytes: 822 },
  { path: "ruaccent/nn/nn_stress_usage_predictor/model.onnx", bytes: 116_473_561, sha256: "3d547500637b4ddfec8880ed6d1405fd50ee9d3f0131ef8a2a69dcf961dbefeb" },
  { path: "ruaccent/nn/nn_stress_usage_predictor/special_tokens_map.json", bytes: 125 },
  { path: "ruaccent/nn/nn_stress_usage_predictor/tokenizer.json", bytes: 2_413_536 },
  { path: "ruaccent/nn/nn_stress_usage_predictor/tokenizer_config.json", bytes: 368 },
  { path: "ruaccent/nn/nn_stress_usage_predictor/vocab.txt", bytes: 1_080_667 },
  { path: "ruaccent/nn/nn_yo_homograph_resolver/config.json", bytes: 625 },
  { path: "ruaccent/nn/nn_yo_homograph_resolver/model.onnx", bytes: 14_332_169, sha256: "42cc85bf0c4b319dfe3d89fa17b162a92fd5e1c651a657cb3d5f44978d4e70ac" },
  { path: "ruaccent/nn/nn_yo_homograph_resolver/special_tokens_map.json", bytes: 125 },
  { path: "ruaccent/nn/nn_yo_homograph_resolver/tokenizer.json", bytes: 126_952 },
  { path: "ruaccent/nn/nn_yo_homograph_resolver/tokenizer_config.json", bytes: 401 },
  { path: "ruaccent/nn/nn_yo_homograph_resolver/vocab.txt", bytes: 48_576 },
  { path: "styles/eng_f3/style_dp.npy", bytes: 640, sha256: "8471b25d2db5281feebc6e03af5bfb413c647368d75cdd8cebc44be36def7948" },
  { path: "styles/eng_f3/style_ttl.npy", bytes: 51_328, sha256: "95fdfe490f5b3d3cf699495309177c405a38a89707bc9c711f93dc083fe099b6" },
  { path: "styles/eng_f4_whisper/style_dp.npy", bytes: 640, sha256: "47031c5fbbea490cba67cfd82f1ffc8ee8ed64c68aa68260f13746c2174ffbfa" },
  { path: "styles/eng_f4_whisper/style_ttl.npy", bytes: 51_328, sha256: "ae4a81c2459e4fccb6206b37c3bba518ac3e23fc91344b07516c5e6125257d59" },
  { path: "styles/eng_f5/style_dp.npy", bytes: 640, sha256: "9629dce9db38b4ab5163429c1eeb9a5771786e58e98e343ea6251bf93a9dfd60" },
  { path: "styles/eng_f5/style_ttl.npy", bytes: 51_328, sha256: "b4cc8b6d271d6ee587b13af7bef8f0151821b24d6af546a1167fa885bd962496" },
  { path: "styles/eng_m2_whisper/style_dp.npy", bytes: 640, sha256: "1a2814cc92643cc102d438d0a70742bacbd01921a78cc0ff39b722ab78b2682c" },
  { path: "styles/eng_m2_whisper/style_ttl.npy", bytes: 51_328, sha256: "e651551d547ca305256bc56062df24c2706308ffccfc5b8ad9735f057975f270" },
  { path: "styles/eng_m3/style_dp.npy", bytes: 640, sha256: "dbcc78e880d2e7c6a45f4bff464ee90c9ba17a2599c9d3cc3dea2c0abcb94524" },
  { path: "styles/eng_m3/style_ttl.npy", bytes: 51_328, sha256: "f0ffd38329830d1556e1096d396c2a807626b9308eb12af84ea4733c712d8d01" },
  { path: "styles/eng_m4/style_dp.npy", bytes: 640, sha256: "526724e17a6d0d917c18db0bac6ac97af15ae63312375129ef294462fbbfc0a2" },
  { path: "styles/eng_m4/style_ttl.npy", bytes: 51_328, sha256: "a8d5016c1aade83d2bdec1e3aa86d0e421ff9e2fb7a781637e64f8a0d8ef663e" },
  { path: "styles/ru_f1/style_dp.npy", bytes: 640, sha256: "189e1eabfccf8f0f76a6b10d84ba0fdde18de2ecc2c2e16e3a790f961db95382" },
  { path: "styles/ru_f1/style_ttl.npy", bytes: 51_328, sha256: "489cb6d10f3e2528d7ac4b3e4d8b01ca54d44b98d193dd26684b16c3a24bd9a7" },
  { path: "styles/ru_f2/style_dp.npy", bytes: 640, sha256: "48c10c8c3e6f9016e4ff625425450b99772a9246ffed6b062d236f23863b27d1" },
  { path: "styles/ru_f2/style_ttl.npy", bytes: 51_328, sha256: "4947fa632443f8ad8343399ac258f67f1e85e9594cf5d42ef7e18d6f6fa3e763" },
  { path: "styles/ru_m1/style_dp.npy", bytes: 640, sha256: "0bbdbe5044f5682152b1fe399f7681424870e03023e857b9706863a6d73bf9e9" },
  { path: "styles/ru_m1/style_ttl.npy", bytes: 51_328, sha256: "0a49356abab63262e3183518eacadd9e073681f87b8bfd86f7b5aed0317fbd0c" },
  { path: "styles/ru_m5/style_dp.npy", bytes: 640, sha256: "79741747bb75e0dac2357c089bc923926c4a34fe46b5ce9f85376b14b8e59bf9" },
  { path: "styles/ru_m5/style_ttl.npy", bytes: 51_328, sha256: "6eccc64350dcc23a8e790eebd7abbec24b0055e6451d975deffa899885e26e99" },
  { path: "teratts.py", bytes: 22_443 },
  { path: "teratts_ruaccent.py", bytes: 13_767 },
  { path: "unicode_indexer.json", bytes: 262_171 }
] as const;

export const TERA_TTS_MODEL_BYTES = TERA_TTS_MODEL_FILES.reduce((total, file) => total + file.bytes, 0);

export function teraTtsModelUrl(path: string) {
  return `https://huggingface.co/TeraSpace/TeraTTSv2/resolve/${LOCAL_TERATTS_MODEL_REVISION}/${path}?download=true`;
}
