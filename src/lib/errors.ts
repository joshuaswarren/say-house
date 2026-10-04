export class AllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowlistError";
  }
}

export class HouseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HouseError";
  }
}
