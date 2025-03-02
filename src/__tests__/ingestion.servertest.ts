/** @jest-environment node */

import { makeAPICall, pruneDatabase } from "@/src/__tests__/test-utils";
import { cleanEvent } from "@/src/pages/api/public/ingestion";
import { prisma } from "@/src/server/db";
import { v4 } from "uuid";

describe("/api/public/ingestion API Endpoint", () => {
  beforeEach(async () => await pruneDatabase());

  [
    {
      usage: {
        input: 100,
        output: 200,
        total: 100,
        unit: "CHARACTERS",
      },
      expectedUnit: "CHARACTERS",
      expectedPromptTokens: 100,
      expectedCompletionTokens: 200,
      expectedTotalTokens: 100,
    },
    {
      usage: {
        total: 100,
        unit: "CHARACTERS",
      },
      expectedUnit: "CHARACTERS",
      expectedPromptTokens: 0,
      expectedCompletionTokens: 0,
      expectedTotalTokens: 100,
    },
    {
      usage: {
        total: 100,
      },
      expectedUnit: "TOKENS",
      expectedPromptTokens: 0,
      expectedCompletionTokens: 0,
      expectedTotalTokens: 100,
    },
    {
      usage: {
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 100,
      },
      expectedPromptTokens: 100,
      expectedCompletionTokens: 200,
      expectedTotalTokens: 100,
      expectedUnit: "TOKENS",
    },
    {
      usage: {
        totalTokens: 100,
      },
      expectedPromptTokens: 0,
      expectedCompletionTokens: 0,
      expectedTotalTokens: 100,
      expectedUnit: "TOKENS",
    },
    {
      usage: undefined,
      expectedPromptTokens: 0,
      expectedCompletionTokens: 0,
      expectedTotalTokens: 0,
      expectedUnit: "TOKENS",
    },
    {
      usage: null,
      expectedPromptTokens: 0,
      expectedCompletionTokens: 0,
      expectedTotalTokens: 0,
      expectedUnit: "TOKENS",
    },
    {
      usage: {},
      expectedPromptTokens: 0,
      expectedCompletionTokens: 0,
      expectedTotalTokens: 0,
      expectedUnit: "TOKENS",
    },
  ].forEach((testConfig) => {
    it(`should create trace and generation ${JSON.stringify(
      testConfig,
    )}`, async () => {
      const traceId = v4();
      const generationId = v4();
      const spanId = v4();
      const scoreId = v4();

      const response = await makeAPICall("POST", "/api/public/ingestion", {
        metadata: {
          sdk_verion: "1.0.0",
          sdk_name: "python",
        },
        batch: [
          {
            id: v4(),
            type: "trace-create",
            timestamp: new Date().toISOString(),
            body: {
              id: traceId,
              name: "trace-name",
              userId: "user-1",
              metadata: { key: "value" },
              release: "1.0.0",
              version: "2.0.0",
              tags: ["tag-1", "tag-2"],
            },
          },
          {
            id: v4(),
            type: "observation-create",
            timestamp: new Date().toISOString(),
            body: {
              id: generationId,
              traceId: traceId,
              type: "GENERATION",
              name: "generation-name",
              startTime: "2021-01-01T00:00:00.000Z",
              endTime: "2021-01-01T00:00:00.000Z",
              modelParameters: { key: "value" },
              input: { key: "value" },
              metadata: { key: "value" },
              version: "2.0.0",
            },
          },
          {
            id: v4(),
            type: "observation-update",
            timestamp: new Date().toISOString(),
            body: {
              id: generationId,
              type: "GENERATION",
              output: { key: "this is a great gpt output" },
              usage: testConfig.usage,
            },
          },
          {
            id: v4(),
            type: "observation-create",
            timestamp: new Date().toISOString(),
            body: {
              id: spanId,
              traceId: traceId,
              type: "SPAN",
              name: "span-name",
              startTime: "2021-01-01T00:00:00.000Z",
              endTime: "2021-01-01T00:00:00.000Z",
              input: { input: "value" },
              metadata: { meta: "value" },
              version: "2.0.0",
            },
          },
          {
            id: v4(),
            type: "score-create",
            timestamp: new Date().toISOString(),
            body: {
              id: scoreId,
              name: "score-name",
              value: 100.5,
              traceId: traceId,
            },
          },
        ],
      });

      expect(response.status).toBe(207);

      console.log("response body", response.body);

      const dbTrace = await prisma.trace.findMany({
        where: {
          name: "trace-name",
        },
      });

      expect(dbTrace.length).toBeGreaterThan(0);
      expect(dbTrace[0]?.name).toBe("trace-name");
      expect(dbTrace[0]?.release).toBe("1.0.0");
      expect(dbTrace[0]?.externalId).toBeNull();
      expect(dbTrace[0]?.version).toBe("2.0.0");
      expect(dbTrace[0]?.projectId).toBe(
        "7a88fb47-b4e2-43b8-a06c-a5ce950dc53a",
      );
      expect(dbTrace[0]?.tags).toEqual(["tag-1", "tag-2"]);

      const dbGeneration = await prisma.observation.findUnique({
        where: {
          id: generationId,
        },
      });

      expect(dbGeneration?.id).toBe(generationId);
      expect(dbGeneration?.traceId).toBe(traceId);
      expect(dbGeneration?.name).toBe("generation-name");
      expect(dbGeneration?.startTime).toEqual(
        new Date("2021-01-01T00:00:00.000Z"),
      );
      expect(dbGeneration?.endTime).toEqual(
        new Date("2021-01-01T00:00:00.000Z"),
      );
      expect(dbGeneration?.model).toBeNull();
      expect(dbGeneration?.modelParameters).toEqual({ key: "value" });
      expect(dbGeneration?.input).toEqual({ key: "value" });
      expect(dbGeneration?.metadata).toEqual({ key: "value" });
      expect(dbGeneration?.version).toBe("2.0.0");
      expect(dbGeneration?.promptTokens).toEqual(
        testConfig.expectedPromptTokens,
      );
      expect(dbGeneration?.completionTokens).toEqual(
        testConfig.expectedCompletionTokens,
      );
      expect(dbGeneration?.totalTokens).toEqual(testConfig.expectedTotalTokens);
      expect(dbGeneration?.unit).toEqual(testConfig.expectedUnit);
      expect(dbGeneration?.output).toEqual({
        key: "this is a great gpt output",
      });

      const dbSpan = await prisma.observation.findUnique({
        where: {
          id: spanId,
        },
      });

      expect(dbSpan?.id).toBe(spanId);
      expect(dbSpan?.name).toBe("span-name");
      expect(dbSpan?.startTime).toEqual(new Date("2021-01-01T00:00:00.000Z"));
      expect(dbSpan?.endTime).toEqual(new Date("2021-01-:00:00.000Z"));
      expect(dbSpan?.input).toEqual({ input: "value" });
      expect(dbSpan?.metadata).toEqual({ meta: "value" });
      expect(dbSpan?.version).toBe("2.0.0");

      const dbScore = await prisma.score.findUnique({
        where: {
          id: scoreId,
        },
      });

      expect(dbScore?.id).toBe(scoreId);
      expect(dbScore?.traceId).toBe(traceId);
      expect(dbScore?.name).toBe("score-name");
      expect(dbScore?.value).toBe(100.5);
      expect(dbScore?.observationId).toBeNull();
    });
  });

  it("should create and update all events", async () => {
    const traceId = v4();
    const generationId = v4();
    const spanId = v4();
    const eventId = v4();
    const scoreId = v4();

    const exception = `
    ERROR    langfuse:callback.py:677 'model_name'
    Traceback (most recent call last):
      File "/Users/maximiliandeichmann/development/github.com/langfuse/langfuse-python/langfuse/callback.py", line 674, in __on_llm_action
        model_name = kwargs["invocation_params"]["model_name"]
    KeyError: 'model_name'
    `;

    const response = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
          },
        },
        {
          id: v4(),
          type: "span-create",
          timestamp: new Date().toISOString(),
          body: {
            id: spanId,
            traceId: traceId,
          },
        },
        {
          id: v4(),
          type: "span-update",
          timestamp: new Date().toISOString(),
          body: {
            id: spanId,
            traceId: traceId,
            name: "span-name",
          },
        },
        {
          id: v4(),
          type: "generation-create",
          timestamp: new Date().toISOString(),
          body: {
            id: generationId,
            traceId: traceId,
            parentObservationId: spanId,
          },
        },
        {
          id: v4(),
          type: "generation-update",
          timestamp: new Date().toISOString(),
          body: {
            id: generationId,
            name: "generation-name",
          },
        },
        {
          id: v4(),
          type: "event-create",
          timestamp: new Date().toISOString(),
          body: {
            id: eventId,
            traceId: traceId,
            name: "event-name",
            parentObservationId: generationId,
          },
        },
        {
          id: v4(),
          type: "score-create",
          timestamp: new Date().toISOString(),
          body: {
            id: scoreId,
            name: "score-name",
            traceId: traceId,
            value: 100.5,
            observationId: generationId,
          },
        },
        {
          id: v4(),
          type: "sdk-log",
          timestamp: new Date().toISOString(),
          body: {
            log: exception,
          },
        },
      ],
    });

    expect(response.status).toBe(207);

    const dbTrace = await prisma.trace.findMany({
      where: {
        id: traceId,
      },
    });

    expect(dbTrace.length).toBeGreaterThan(0);
    expect(dbTrace[0]?.projectId).toBe("7a88fb47-b4e2-43b8-a06c-a5ce950dc53a");

    const dbSpan = await prisma.observation.findUnique({
      where: {
        id: spanId,
      },
    });

    expect(dbSpan?.id).toBe(spanId);
    expect(dbSpan?.name).toBe("span-name");
    expect(dbSpan?.traceId).toBe(traceId);

    const dbGeneration = await prisma.observation.findUnique({
      where: {
        id: generationId,
      },
    });

    expect(dbGeneration?.id).toBe(generationId);
    expect(dbGeneration?.traceId).toBe(traceId);
    expect(dbGeneration?.name).toBe("generation-name");
    expect(dbGeneration?.parentObservationId).toBe(spanId);

    const dbEvent = await prisma.observation.findUnique({
      where: {
        id: eventId,
      },
    });

    expect(dbEvent?.id).toBe(eventId);
    expect(dbEvent?.traceId).toBe(traceId);
    expect(dbEvent?.name).toBe("event-name");
    expect(dbEvent?.parentObservationId).toBe(generationId);

    const dbScore = await prisma.score.findUnique({
      where: {
        id: scoreId,
      },
    });

    expect(dbScore?.id).toBe(scoreId);
    expect(dbScore?.traceId).toBe(traceId);
    expect(dbScore?.observationId).toBe(generationId);
    expect(dbScore?.value).toBe(100.5);

    const logEvent = await prisma.events.findFirst({
      where: {
        data: {
          path: ["body", "log"],
          string_contains: "ERROR",
        },
      },
    });

    expect(logEvent).toBeDefined();
    expect(logEvent).not.toBeFalsy();
    expect(JSON.stringify(logEvent?.data)).toContain("KeyError: 'model_name'");
  });

  it("should upsert threats", async () => {
    const traceId = v4();

    const responseOne = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
            userId: "user-1",
            metadata: { key: "value" },
            release: "1.0.0",
            version: "2.0.0",
          },
        },
      ],
    });
    expect(responseOne.status).toBe(207);

    const responseTwo = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
            userId: "user-2",
          },
        },
      ],
    });

    expect(responseTwo.status).toBe(207);

    const dbTrace = await prisma.trace.findMany({
      where: {
        name: "trace-name",
      },
    });

    expect(dbTrace.length).toBeGreaterThan(0);
    expect(dbTrace[0]?.name).toBe("trace-name");
    expect(dbTrace[0]?.userId).toBe("user-2");
    expect(dbTrace[0]?.release).toBe("1.0.0");
    expect(dbTrace[0]?.externalId).toBeNull();
    expect(dbTrace[0]?.version).toBe("2.0.0");
    expect(dbTrace[0]?.projectId).toBe("7a88fb47-b4e2-43b8-a06c-a5ce950dc53a");
  });

  it("should fail for wrong event formats", async () => {
    const traceId = v4();

    const responseOne = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: "invalid-event",
        },
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
            userId: "user-1",
            metadata: { key: "value" },
            release: "1.0.0",
            version: "2.0.0",
          },
        },
      ],
    });
    expect(responseOne.status).toBe(207);

    expect("errors" in responseOne.body).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(responseOne.body?.errors.length).toBe(1);
    expect("successes" in responseOne.body).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(responseOne.body?.successes.length).toBe(1);

    const dbTrace = await prisma.trace.findMany({
      where: {
        name: "trace-name",
      },
    });

    expect(dbTrace.length).toBe(1);
  });

  it("should fail for auth errors", async () => {
    const traceId = v4();
    const scoreId = v4();

    const responseOne = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
            userId: "user-1",
            metadata: { key: "value" },
            release: "1.0.0",
            version: "2.0.0",
          },
        },
        {
          id: v4(),
          type: "score-create",
          timestamp: new Date().toISOString(),
          body: {
            id: scoreId,
            name: "score-name",
            value: 100.5,
            traceId: "some-random-id",
          },
        },
      ],
    });

    console.log(responseOne.body);
    expect(responseOne.status).toBe(207);

    expect("errors" in responseOne.body).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(responseOne.body?.errors.length).toBe(1);
    expect("successes" in responseOne.body).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(responseOne.body?.successes.length).toBe(1);

    const dbTrace = await prisma.trace.findMany({
      where: {
        name: "trace-name",
      },
    });

    expect(dbTrace.length).toBe(1);
  });

  it("should fail for resource not found", async () => {
    const traceId = v4();

    const responseOne = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
            userId: "user-1",
            metadata: { key: "value" },
            release: "1.0.0",
            version: "2.0.0",
          },
        },
        {
          id: v4(),
          type: "observation-update",
          timestamp: new Date().toISOString(),
          body: {
            id: "some-random-id",
            type: "GENERATION",
            output: { key: "this is a great gpt output" },
          },
        },
      ],
    });

    console.log(responseOne.body);
    expect(responseOne.status).toBe(207);

    expect("errors" in responseOne.body).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(responseOne.body?.errors.length).toBe(1);
    expect("successes" in responseOne.body).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(responseOne.body?.successes.length).toBe(1);

    const dbTrace = await prisma.trace.findMany({
      where: {
        name: "trace-name",
      },
    });

    expect(dbTrace.length).toBe(1);
  });

  it("should update all token counts if update does not contain model name", async () => {
    const traceId = v4();
    const generationId = v4();

    const responseOne = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
            userId: "user-1",
          },
        },
        {
          id: v4(),
          type: "observation-create",
          timestamp: new Date().toISOString(),
          body: {
            id: generationId,
            traceId: traceId,
            type: "GENERATION",
            name: "generation-name",
            input: { key: "value" },
            model: "gpt-3.5",
          },
        },
        {
          id: v4(),
          type: "observation-update",
          timestamp: new Date().toISOString(),
          body: {
            id: generationId,
            type: "GENERATION",
            output: { key: "this is a great gpt output" },
          },
        },
      ],
    });
    expect(responseOne.status).toBe(207);

    const dbTrace = await prisma.trace.findMany({
      where: {
        name: "trace-name",
      },
    });

    expect(dbTrace.length).toEqual(1);

    const observation = await prisma.observation.findUnique({
      where: {
        id: generationId,
      },
    });

    expect(observation?.output).toEqual({
      key: "this is a great gpt output",
    });
    expect(observation?.input).toEqual({ key: "value" });
    expect(observation?.model).toEqual("gpt-3.5");
    expect(observation?.output).toEqual({ key: "this is a great gpt output" });
    expect(observation?.promptTokens).toEqual(5);
    expect(observation?.completionTokens).toEqual(11);
  });

  it("should update all token counts if update does not contain model name and events come in wrong order", async () => {
    const traceId = v4();
    const generationId = v4();

    const responseOne = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
            userId: "user-1",
          },
        },
        {
          id: v4(),
          type: "observation-update",
          timestamp: new Date().toISOString(),
          body: {
            id: generationId,
            type: "GENERATION",
            output: { key: "this is a great gpt output" },
          },
        },
        {
          id: v4(),
          type: "observation-create",
          timestamp: new Date().toISOString(),
          body: {
            id: generationId,
            traceId: traceId,
            type: "GENERATION",
            name: "generation-name",
            input: { key: "value" },
            model: "gpt-3.5",
          },
        },
      ],
    });
    expect(responseOne.status).toBe(207);

    const dbTrace = await prisma.trace.findMany({
      where: {
        name: "trace-name",
      },
    });

    expect(dbTrace.length).toEqual(1);

    const observation = await prisma.observation.findUnique({
      where: {
        id: generationId,
      },
    });

    expect(observation?.output).toEqual({
      key: "this is a great gpt output",
    });
    expect(observation?.input).toEqual({ key: "value" });
    expect(observation?.model).toEqual("gpt-3.5");
    expect(observation?.output).toEqual({ key: "this is a great gpt output" });
    expect(observation?.promptTokens).toEqual(5);
    expect(observation?.completionTokens).toEqual(11);
  });

  it("null does not override set values", async () => {
    const traceId = v4();

    const responseOne = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
            userId: "user-1",
            metadata: { key: "value" },
            release: "1.0.0",
            version: "2.0.0",
          },
        },
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
            userId: "user-1",
            metadata: { key: "value" },
            release: null,
            version: null,
          },
        },
      ],
    });
    expect(responseOne.status).toBe(207);

    const dbTrace = await prisma.trace.findMany({
      where: {
        name: "trace-name",
      },
    });

    expect(dbTrace.length).toEqual(1);
    expect(dbTrace[0]?.release).toBe("1.0.0");
    expect(dbTrace[0]?.version).toBe("2.0.0");
  });

  [
    {
      inputs: [{ a: "a" }, { b: "b" }],
      output: { a: "a", b: "b" },
    },
    {
      inputs: [[{ a: "a" }], [{ b: "b" }]],
      output: [{ a: "a", b: "b" }],
    },
    {
      inputs: [
        {
          a: {
            "1": 1,
          },
        },
        {
          b: "b",
          a: {
            "2": 2,
          },
        },
      ],
      output: { a: { "1": 1, "2": 2 }, b: "b" },
    },
    {
      inputs: [{ a: "a" }, undefined],
      output: { a: "a" },
    },
    {
      inputs: [undefined, { b: "b" }],
      output: { b: "b" },
    },
  ].forEach(({ inputs, output }) => {
    it(`merges metadata ${JSON.stringify(inputs)}, ${JSON.stringify(
      output,
    )}`, async () => {
      const traceId = v4();
      const generationId = v4();

      const responseOne = await makeAPICall("POST", "/api/public/ingestion", {
        batch: [
          {
            id: v4(),
            type: "trace-create",
            timestamp: new Date().toISOString(),
            body: {
              id: traceId,
              name: "trace-name",
              userId: "user-1",
              metadata: inputs[0],
            },
          },
          {
            id: v4(),
            type: "trace-create",
            timestamp: new Date().toISOString(),
            body: {
              id: traceId,
              name: "trace-name",
              metadata: inputs[1],
            },
          },
          {
            id: v4(),
            type: "observation-create",
            timestamp: new Date().toISOString(),
            body: {
              id: generationId,
              traceId: traceId,
              type: "GENERATION",
              name: "generation-name",
              metadata: inputs[0],
            },
          },
          {
            id: v4(),
            type: "observation-update",
            timestamp: new Date().toISOString(),
            body: {
              id: generationId,
              traceId: traceId,
              type: "GENERATION",
              metadata: inputs[1],
            },
          },
        ],
      });
      expect(responseOne.status).toBe(207);

      const dbTrace = await prisma.trace.findMany({
        where: {
          name: "trace-name",
        },
      });

      expect(dbTrace.length).toEqual(1);
      expect(dbTrace[0]?.metadata).toEqual(output);

      const dbGeneration = await prisma.observation.findMany({
        where: {
          name: "generation-name",
        },
      });

      expect(dbGeneration.length).toEqual(1);
      expect(dbGeneration[0]?.metadata).toEqual(output);
    });
  });

  it("additional fields do not fail the API to support users sending traceidtype Langfuse", async () => {
    const traceId = v4();
    const generationId = v4();

    const responseOne = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
          },
        },
        {
          id: v4(),
          type: "observation-create",
          timestamp: new Date().toISOString(),
          body: {
            id: generationId,
            traceId: traceId,
            type: "GENERATION",
            name: "generation-name",
            traceIdType: "LANGFUSE",
          },
        },
      ],
    });
    expect(responseOne.status).toBe(207);

    const dbTrace = await prisma.trace.findMany({
      where: {
        id: traceId,
      },
    });

    expect(dbTrace.length).toEqual(1);

    const dbGeneration = await prisma.observation.findUnique({
      where: {
        id: generationId,
      },
    });

    expect(dbGeneration).toBeTruthy();
  });

  it("filters out NULL characters", async () => {
    const traceId = v4();
    const generationId = v4();

    const responseOne = await makeAPICall("POST", "/api/public/ingestion", {
      batch: [
        {
          id: v4(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "trace-name",
          },
        },
        {
          id: v4(),
          type: "observation-create",
          timestamp: new Date().toISOString(),
          body: {
            id: generationId,
            traceId: traceId,
            type: "GENERATION",
            name: "generation-name",
            traceIdType: "LANGFUSE",
            input: {
              key: "IB\nibo.org Change site\nIB Home   /   . . .   /   News   /   News about the IB   /   Why ChatGPT is an opportunity for schools  IB Home   /   News   /   News about the IB   /   Why ChatGPT is an opportunity for schools  Why ChatGPT is an opportunity for  schools  Published:   06 March 2023   Last updated:   06 June 2023  Date published:   28 February 2023  Dr Matthew Glanville, Head of Assessment Principles and Practice  Source:   Why ChatGPT is an opportunity for schools | The Times  Those of us who work in the schools or exam sector should not be terri \u0000 ed by ChatGPT and  the rise of AI software – we should be excited. We should embrace it as an extraordinary  opportunity.  Contrary to some stark warnings, it is not the end of exams, nor even a huge threat to  coursework, but it does bring into very sharp focus the impact that arti \u0000 ",
            },
            output: {
              key: "제점이 있었죠. 그중 하나는 일제가 한국의 신용체계를 망가뜨린 채 한국을 떠났다는 겁니다. 해방전 일제는 조선의 신용체계를 거의 독점적으로 소유한 상황이었습니다. 1945년 6월 기준 일제는 조선의 본점을 둔 전체은행 5개의 불입자본 총액의 89.7%를",
            },
          },
        },
      ],
    });
    expect(responseOne.status).toBe(207);

    const dbTrace = await prisma.trace.findMany({
      where: {
        id: traceId,
      },
    });

    expect(dbTrace.length).toEqual(1);

    const dbGeneration = await prisma.observation.findUnique({
      where: {
        id: generationId,
      },
    });
    expect(dbGeneration?.input).toStrictEqual({
      key: `IB
ibo.org Change site
IB Home   /   . . .   /   News   /   News about the IB   /   Why ChatGPT is an opportunity for schools  IB Home   /   News   /   News about the IB   /   Why ChatGPT is an opportunity for schools  Why ChatGPT is an opportunity for  schools  Published:   06 March 2023   Last updated:   06 June 2023  Date published:   28 February 2023  Dr Matthew Glanville, Head of Assessment Principles and Practice  Source:   Why ChatGPT is an opportunity for schools | The Times  Those of us who work in the schools or exam sector should not be terri  ed by ChatGPT and  the rise of AI software – we should be excited. We should embrace it as an extraordinary  opportunity.  Contrary to some stark warnings, it is not the end of exams, nor even a huge threat to  coursework, but it does bring into very sharp focus the impact that arti  `,
    });
    expect(dbGeneration?.output).toStrictEqual({
      key: "제점이 있었죠. 그중 하나는 일제가 한국의 신용체계를 망가뜨린 채 한국을 떠났다는 겁니다. 해방전 일제는 조선의 신용체계를 거의 독점적으로 소유한 상황이었습니다. 1945년 6월 기준 일제는 조선의 본점을 둔 전체은행 5개의 불입자본 총액의 89.7%를",
    });

    expect(dbGeneration).toBeTruthy();
  });

  [
    { input: "A\u0000hallo", expected: "Ahallo" },
    { input: ["A\u0000hallo"], expected: ["Ahallo"] },
    { input: { obj: ["A\u0000hallo"] }, expected: { obj: ["Ahallo"] } },
  ].forEach(({ input, expected }) => {
    it(`cleans events with null values ${JSON.stringify(
      input,
    )} ${JSON.stringify(expected)}`, () => {
      const cleanedEvent = cleanEvent(input);
      console.log(cleanedEvent);
      expect(cleanedEvent).toStrictEqual(expected);
    });
  });
});
