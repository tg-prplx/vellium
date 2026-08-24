/** Identifies an optional model parameter that is absent from the loaded puppet. */
export class MissingModelParameterError extends Error {
  constructor(id: string) {
    super(`model does not expose parameter ${id}`);
    this.name = "MissingModelParameterError";
  }
}
