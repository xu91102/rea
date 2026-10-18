import { z } from "zod";

/** Client timeout values retain exact TOML integers and finite JSON numbers. */
export const clientRegistrationTimeoutSchema = z.union([
  z.number().positive(),
  z.bigint().positive(),
]);

type ClientRegistrationTimeout = z.output<
  typeof clientRegistrationTimeoutSchema
>;

/** Read the same positive timeout fact that registration diagnostics accept. */
export const readClientRegistrationTimeout = (
  registration: unknown,
  key: string,
): ClientRegistrationTimeout | undefined => {
  if (typeof registration !== "object" || registration === null) return;
  const parsed = clientRegistrationTimeoutSchema.safeParse(
    Reflect.get(registration, key),
  );
  return parsed.success ? parsed.data : undefined;
};

/** Compare client deadlines in milliseconds without rounding exact integers. */
export const clientRegistrationTimeoutMilliseconds = (
  value: ClientRegistrationTimeout,
  unit: "seconds" | "milliseconds",
): ClientRegistrationTimeout =>
  unit === "milliseconds"
    ? value
    : typeof value === "bigint"
      ? value * 1000n
      : value * 1000;
