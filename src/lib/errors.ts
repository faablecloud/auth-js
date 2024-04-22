/**
 * Known error codes. Note that the server may also return other error codes
 * not included in this list (if the client library is older than the version
 * on the server).
 */
export type ErrorCode =
  | "unexpected_failure"
  | "validation_failed"
  | "bad_json"
  | "email_exists"
  | "phone_exists"
  | "bad_jwt"
  | "not_admin"
  | "no_authorization"
  | "user_not_found"
  | "session_not_found"
  | "flow_state_not_found"
  | "flow_state_expired"
  | "signup_disabled"
  | "user_banned"
  | "provider_email_needs_verification"
  | "invite_not_found"
  | "bad_oauth_state"
  | "bad_oauth_callback"
  | "oauth_provider_not_supported"
  | "unexpected_audience"
  | "single_identity_not_deletable"
  | "email_conflict_identity_not_deletable"
  | "identity_already_exists"
  | "email_provider_disabled"
  | "phone_provider_disabled"
  | "too_many_enrolled_mfa_factors"
  | "mfa_factor_name_conflict"
  | "mfa_factor_not_found"
  | "mfa_ip_address_mismatch"
  | "mfa_challenge_expired"
  | "mfa_verification_failed"
  | "mfa_verification_rejected"
  | "insufficient_aal"
  | "captcha_failed"
  | "saml_provider_disabled"
  | "manual_linking_disabled"
  | "sms_send_failed"
  | "email_not_confirmed"
  | "phone_not_confirmed"
  | "reauth_nonce_missing"
  | "saml_relay_state_not_found"
  | "saml_relay_state_expired"
  | "saml_idp_not_found"
  | "saml_assertion_no_user_id"
  | "saml_assertion_no_email"
  | "user_already_exists"
  | "sso_provider_not_found"
  | "saml_metadata_fetch_failed"
  | "saml_idp_already_exists"
  | "sso_domain_already_exists"
  | "saml_entity_id_mismatch"
  | "conflict"
  | "provider_disabled"
  | "user_sso_managed"
  | "reauthentication_needed"
  | "same_password"
  | "reauthentication_not_valid"
  | "otp_expired"
  | "otp_disabled"
  | "identity_not_found"
  | "weak_password"
  | "over_request_rate_limit"
  | "over_email_send_rate_limit"
  | "over_sms_send_rate_limit"
  | "bad_code_verifier";

export class AuthError extends Error {
  /**
   * Error code associated with the error. Most errors coming from
   * HTTP responses will have a code, though some errors that occur
   * before a response is received will not have one present. In that
   * case {@link #status} will also be undefined.
   */
  code: ErrorCode | string | undefined;

  /** HTTP status code that caused the error. */
  status: number | undefined;

  protected __isAuthError = true;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export class CustomAuthError extends AuthError {
  name: string;
  status: number;

  constructor(
    message: string,
    name: string,
    status: number,
    code: string | undefined
  ) {
    super(message, status, code);
    this.name = name;
    this.status = status;
  }
}

export class AuthSessionMissingError extends CustomAuthError {
  constructor() {
    super("Auth session missing!", "AuthSessionMissingError", 400, undefined);
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return (
    typeof error === "object" && error !== null && "__isAuthError" in error
  );
}

export class AuthApiError extends AuthError {
  status: number;

  constructor(message: string, status: number, code: string | undefined) {
    super(message, status, code);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

export function isAuthApiError(error: unknown): error is AuthApiError {
  return isAuthError(error) && error.name === "AuthApiError";
}

export class AuthImplicitGrantRedirectError extends CustomAuthError {
  details: { error: string; code: string } | null = null;
  constructor(
    message: string,
    details: { error: string; code: string } | null = null
  ) {
    super(message, "AuthImplicitGrantRedirectError", 500, undefined);
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      details: this.details,
    };
  }
}

export class AuthPKCEGrantCodeExchangeError extends CustomAuthError {
  details: { error: string; code: string } | null = null;

  constructor(
    message: string,
    details: { error: string; code: string } | null = null
  ) {
    super(message, "AuthPKCEGrantCodeExchangeError", 500, undefined);
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      details: this.details,
    };
  }
}

export class AuthUnknownError extends AuthError {
  originalError: unknown;

  constructor(message: string, originalError: unknown) {
    super(message);
    this.name = "AuthUnknownError";
    this.originalError = originalError;
  }
}

export class AuthInvalidTokenResponseError extends CustomAuthError {
  constructor() {
    super(
      "Auth session or user missing",
      "AuthInvalidTokenResponseError",
      500,
      undefined
    );
  }
}

export class AuthRetryableFetchError extends CustomAuthError {
  constructor(message: string, status: number) {
    super(message, "AuthRetryableFetchError", status, undefined);
  }
}

export function isAuthRetryableFetchError(
  error: unknown
): error is AuthRetryableFetchError {
  return isAuthError(error) && error.name === "AuthRetryableFetchError";
}
