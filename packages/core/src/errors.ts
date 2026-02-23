/** Base error class for all Mecha errors */
export class MechaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Container with the specified ID was not found */
export class ContainerNotFoundError extends MechaError {
  constructor(id: string) { super(`Container not found: ${id}`, "CONTAINER_NOT_FOUND"); }
}

/** Container with the specified ID already exists */
export class ContainerAlreadyExistsError extends MechaError {
  constructor(id: string) { super(`Container already exists: ${id}`, "CONTAINER_ALREADY_EXISTS"); }
}

/** The provided path is invalid or does not exist */
export class InvalidPathError extends MechaError {
  constructor(path: string) { super(`Invalid path: ${path}`, "INVALID_PATH"); }
}
