import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

/**
 * Matches a caught error against a specific Prisma error code (e.g. "P2025"
 * not found, "P2002" unique constraint) and returns the JSON response a
 * route should send for it, or null if this error isn't that code — callers
 * re-throw on null so anything unexpected still surfaces as a real failure
 * instead of being swallowed.
 */
export function prismaErrorResponse(
  err: unknown,
  code: string,
  message: string,
  status: number = 404,
): NextResponse | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === code) {
    return NextResponse.json({ error: message }, { status });
  }
  return null;
}
