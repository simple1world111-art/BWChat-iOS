import { APIError, apiRequest, decodeSuccessfulPayload } from "@/api/client";

describe("API successful envelope decoding", () => {
  it("returns ordinary envelope data without changing existing API callers", () => {
    expect(
      decodeSuccessfulPayload({ code: 409, message: "ignored", data: { id: 1 } }, 200),
    ).toEqual({ id: 1 });
  });

  it.each([
    ["integer", 409, 409],
    ["numeric string", "409", 409],
  ])(
    "rejects a required nonzero %s success code without losing its payload",
    (_label, raw, code) => {
      const payload = { code: raw, message: "already claimed", data: { id: 1 } };
      expect(() => decodeSuccessfulPayload(payload, 200, true, true, true)).toThrow(
        expect.objectContaining({
          status: 200,
          code,
          message: "already claimed",
          payload,
        }),
      );
    },
  );

  it.each([
    ["missing", undefined, "decoding_error"],
    ["invalid", " 409 ", " 409 "],
  ])("rejects a %s required success code", (_label, rawCode, expectedCode) => {
    const payload: Record<string, unknown> = { message: "ok", data: { id: 1 } };
    if (rawCode !== undefined) payload.code = rawCode;
    expect(() => decodeSuccessfulPayload(payload, 200, true, true, true)).toThrow(
      expect.objectContaining({ status: 200, code: expectedCode, message: "ok", payload }),
    );
  });

  it("uses native server-unavailable presentation while preserving a required 5xx code", () => {
    const payload = { code: "503", message: "raw upstream detail", data: { id: 1 } };
    expect(() => decodeSuccessfulPayload(payload, 200, true, true, true)).toThrow(
      expect.objectContaining({
        status: 200,
        code: 503,
        message: "服务暂时不可用，请稍后重试",
        payload,
      }),
    );
  });

  it("checks a required nonzero wrapper code before rejecting its omitted data", () => {
    const payload = { code: "503", message: "raw upstream detail" };
    expect(() => decodeSuccessfulPayload(payload, 200, true, true, true)).toThrow(
      expect.objectContaining({
        status: 200,
        code: 503,
        message: "服务暂时不可用，请稍后重试",
        payload,
      }),
    );
  });

  it("preserves a required-data envelope code, message and payload", () => {
    let error: unknown;
    try {
      decodeSuccessfulPayload({ code: 409, message: "already claimed", data: null }, 200, true);
    } catch (value) {
      error = value;
    }
    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({
      status: 200,
      code: 409,
      message: "already claimed",
      payload: { code: 409, message: "already claimed", data: null },
    });
  });

  it("sanitizes a numeric-string 5xx envelope like native APIError", () => {
    expect(() =>
      decodeSuccessfulPayload(
        { code: "503", message: "raw upstream infrastructure detail", data: null },
        200,
        true,
      ),
    ).toThrow("服务暂时不可用，请稍后重试");
  });

  it.each([
    ["empty object", {}, 0],
    ["explicit zero code", { code: 0 }, 0],
    ["direct auth object", { token: "access", refresh_token: "refresh", user: {} }, 0],
  ])("decodes a %s as a native wrapper whose required data is absent", (_label, payload, code) => {
    let error: unknown;
    try {
      decodeSuccessfulPayload(payload, 200, true, true);
    } catch (value) {
      error = value;
    }
    expect(error).toMatchObject({
      status: 200,
      code,
      message: "api.invalidResponse",
      payload,
    });
  });

  it("accepts a wrapper with omitted data for native EmptyData responses", () => {
    expect(decodeSuccessfulPayload({ code: 0, message: "ok" }, 200, false, true)).toBeUndefined();
  });

  it.each([
    ["integer", 6002, 6002],
    ["numeric string", "-7", -7],
    ["invalid string", " 6002 ", 0],
    ["floating number", 6.5, 0],
    ["wrong type", { value: 6002 }, 0],
  ])("normalizes a native %s wrapper code", (_label, rawCode, expectedCode) => {
    expect(() =>
      decodeSuccessfulPayload(
        { code: rawCode, message: "revision conflict", data: null },
        200,
        true,
        true,
      ),
    ).toThrow(
      expect.objectContaining({
        status: 200,
        code: expectedCode,
        message: "revision conflict",
      }),
    );
  });

  it.each([
    ["missing", undefined, "api.invalidResponse"],
    ["empty", "", "api.invalidResponse"],
    ["Foundation blank", " \u200B\n", "api.invalidResponse"],
    ["numeric", 503, "api.invalidResponse"],
    ["raw spaced", "  revision conflict  ", "  revision conflict  "],
    ["FEFF nonblank", "\uFEFF", "\uFEFF"],
  ])("keeps native %s message semantics", (_label, rawMessage, expectedMessage) => {
    const payload = { code: "409", data: null } as Record<string, unknown>;
    if (rawMessage !== undefined) payload.message = rawMessage;
    expect(() => decodeSuccessfulPayload(payload, 200, true, true)).toThrow(
      expect.objectContaining({
        status: 200,
        code: 409,
        message: expectedMessage,
        payload,
      }),
    );
  });

  it("keeps scalar payloads in the decoding-error category", () => {
    for (const payload of [null, [], "invalid JSON", 3]) {
      expect(() => decodeSuccessfulPayload(payload, 200, true, true)).toThrow(
        expect.objectContaining({ code: "decoding_error", message: "api.decodingError" }),
      );
    }
  });

  it("returns present data for endpoint-specific strict normalization", () => {
    const malformedAuthData = { token: "access", user: {} };
    expect(
      decodeSuccessfulPayload({ code: 0, message: "ok", data: malformedAuthData }, 200, true, true),
    ).toEqual(malformedAuthData);
  });
});

describe("API transient retry option", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps the existing retry default for an idempotency-key POST", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(503, { message: "retry" }))
      .mockResolvedValueOnce(mockResponse(503, { message: "retry" }))
      .mockResolvedValueOnce(mockResponse(200, { data: { ok: true } }));

    await expect(
      apiRequest<{ ok: boolean }>("/retry-default", {
        method: "POST",
        headers: { "Idempotency-Key": "stable-key" },
        body: {},
        requiredData: true,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("can disable transient retries without leaking the option into fetch", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockResponse(503, { message: "do not retry" }));

    await expect(
      apiRequest("/retry-disabled", {
        method: "POST",
        headers: { "Idempotency-Key": "stable-key" },
        body: {},
        transientRetries: false,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("transientRetries");
  });

  it("enforces a success code without leaking the option into fetch", async () => {
    const payload = { code: 409, message: "round rejected", data: { ok: false } };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(200, payload));

    await expect(
      apiRequest("/strict-success-code", {
        requiredData: true,
        requiredEnvelope: true,
        requiredSuccessCode: true,
      }),
    ).rejects.toMatchObject({ status: 200, code: 409, message: "round rejected", payload });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("requiredSuccessCode");
  });

  it("rejects symbolic or missing codes on endpoints that require an explicit success code", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse(200, {
          code: "INVALID_VERIFICATION_CODE",
          message: "invalid code",
          data: {},
        }),
      )
      .mockResolvedValueOnce(mockResponse(200, { message: "ok", data: {} }));

    const options = {
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
    } as const;
    await expect(apiRequest("/strict-symbolic-code", options)).rejects.toMatchObject({
      code: "INVALID_VERIFICATION_CODE",
    });
    await expect(apiRequest("/strict-missing-code", options)).rejects.toMatchObject({
      code: "decoding_error",
      message: "ok",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function mockResponse(status: number, payload: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ "Retry-After": "0" }),
    json: async () => payload,
  } as Response;
}
