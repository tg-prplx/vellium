import { fetchProviderResponse } from "../../services/providerHttp.js";

/** Some older compatible servers reject stream_options before starting inference. */
export async function fetchChatStream(url: string, init: RequestInit, body: Record<string, unknown>): Promise<Response> {
  const response = await fetchProviderResponse(url, { ...init, body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }) });
  if (response.status !== 400 && response.status !== 422) return response;
  const error = await response.clone().text();
  if (!/stream_options|include_usage/i.test(error) || !/unknown|unsupported|unexpected|extra|not permitted|not allowed|unrecognized/i.test(error)) return response;
  return fetchProviderResponse(url, { ...init, body: JSON.stringify({ ...body, stream: true }) });
}
