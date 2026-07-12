/** Provider ist vorhanden, aber (noch) nicht konfiguriert/aktiviert. */
export class ProviderNotConfiguredError extends Error {
  constructor(providerKey: string, hint?: string) {
    super(
      `Provider "${providerKey}" ist nicht konfiguriert oder deaktiviert.` +
        (hint ? ` ${hint}` : "")
    );
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderRequestError extends Error {
  constructor(providerKey: string, message: string) {
    super(`Provider "${providerKey}": ${message}`);
    this.name = "ProviderRequestError";
  }
}
