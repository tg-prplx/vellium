/** Identifies an optional model parameter that is absent from the loaded puppet. */
export class MissingModelParameterError extends Error {
    constructor(id) {
        super(`model does not expose parameter ${id}`);
        this.name = "MissingModelParameterError";
    }
}
//# sourceMappingURL=errors.js.map