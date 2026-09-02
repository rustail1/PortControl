export interface ConfigSource {
  readonly configs: Readonly<Record<string, unknown>>;
  readonly schemas: Readonly<Record<string, unknown>>;
}

export interface ConfigBundle {
  readonly configs: Readonly<Record<string, Record<string, unknown>>>;
  readonly levels: Readonly<Record<string, Record<string, unknown>>>;
}
