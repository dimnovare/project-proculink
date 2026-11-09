import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SourceDocumentBody } from "./SourceDocumentBody";

afterEach(cleanup);
beforeAll(() => {
  URL.createObjectURL ??= () => "blob:photo";
  URL.revokeObjectURL ??= () => {};
});

describe("SourceDocumentBody image", () => {
  it("the original shows an image document as an image", () => {
    const document = { blob: new Blob(["x"], { type: "image/png" }), contentType: "image/png", filename: "photo.png" };
    render(<QueryClientProvider client={new QueryClient()}><SourceDocumentBody cacheKey="d" document={document} bounded={false} /></QueryClientProvider>);
    expect(screen.getByRole("img", { name: "photo.png" })).toBeTruthy();
  });
});
