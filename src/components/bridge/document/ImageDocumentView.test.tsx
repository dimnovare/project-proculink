import { describe, it, expect, beforeAll, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/saveBlob", () => ({ saveBlob: vi.fn() }));
import { saveBlob } from "@/lib/saveBlob";
import { ImageDocumentView } from "./ImageDocumentView";

beforeAll(() => {
  URL.createObjectURL ??= () => "blob:photo";
  URL.revokeObjectURL ??= () => {};
});

describe("ImageDocumentView", () => {
  it("a picture the browser cannot draw says so and offers the file instead of a broken image", () => {
    const blob = new Blob(["x"], { type: "image/png" });
    render(<ImageDocumentView blob={blob} contentType="image/png" filename="photo.png" />);
    fireEvent.error(screen.getByRole("img", { name: "photo.png" }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("We couldn't show this picture. Download it to look at it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(saveBlob).toHaveBeenCalledWith(blob, "photo.png");
  });
});
