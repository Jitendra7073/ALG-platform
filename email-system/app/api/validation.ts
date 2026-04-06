/**
 * Validation utilities for API routes
 */

import { NextResponse } from 'next/server';
import { ApiResponse } from './types';

// ============================================================================
// Error Response Helpers
// ============================================================================

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorResponse(statusCode: number, message: string): NextResponse<ApiResponse> {
  return NextResponse.json(
    { success: false, error: message },
    { status },
  );
}

export function successResponse<T>(data: T, message?: string): NextResponse<ApiResponse<T>> {
  return NextResponse.json({
    success: true,
    data,
    ...(message && { message }),
  });
}

export function notFound(message = 'Resource not found'): NextResponse<ApiResponse> {
  return errorResponse(404, message);
}

export function badRequest(message = 'Bad request'): NextResponse<ApiResponse> {
  return errorResponse(400, message);
}

export function serverError(message = 'Internal server error'): NextResponse<ApiResponse> {
  return errorResponse(500, message);
}

export function unauthorized(message = 'Unauthorized'): NextResponse<ApiResponse> {
  return errorResponse(401, message);
}

// ============================================================================
// Validation Helpers
// ============================================================================

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function validateRequired<T extends Record<string, unknown>>(
  data: T,
  fields: (keyof T)[],
): string | null {
  for (const field of fields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      return `${String(field)} is required`;
    }
  }
  return null;
}

// ============================================================================
// Query Param Helpers
// ============================================================================

export function getQueryParam(
  url: URL,
  key: string,
  defaultValue?: string,
): string | undefined {
  return url.searchParams.get(key) || defaultValue;
}

export function getQueryNumber(
  url: URL,
  key: string,
  defaultValue?: number,
): number | undefined {
  const value = url.searchParams.get(key);
  if (value === null) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

export function getQueryBoolean(
  url: URL,
  key: string,
  defaultValue = false,
): boolean {
  const value = url.searchParams.get(key);
  if (value === null) return defaultValue;
  return value === 'true' || value === '1';
}

// ============================================================================
// Pagination Helpers
// ============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
}

export function getPaginationParams(url: URL): PaginationParams {
  const page = getQueryNumber(url, 'page', 1);
  const limit = getQueryNumber(url, 'limit', 50);
  const offset = getQueryNumber(url, 'offset');

  // Validate limits
  const validatedLimit = Math.min(Math.max(limit || 50, 1), 100);
  const validatedOffset = offset ?? ((page ? page - 1 : 0) * validatedLimit);

  return {
    page: page || 1,
    limit: validatedLimit,
    offset: validatedOffset,
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export function getPaginationMeta(
  params: PaginationParams,
  total: number,
): PaginationMeta {
  const limit = params.limit || 50;
  const page = params.page || 1;

  return {
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
  };
}

// ============================================================================
// Route Parameter Helpers
// ============================================================================

export function getIdParam(params: { id?: string }): number {
  const id = params.id ? parseInt(params.id, 10) : NaN;
  if (isNaN(id)) {
    throw new ApiError(400, 'Invalid ID parameter');
  }
  return id;
}

// ============================================================================
// Async Route Handler Wrapper
// ============================================================================

type RouteHandler = (
  request: Request,
  context?: { params?: Record<string, string> },
) => Promise<NextResponse>;

export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) {
        return errorResponse(error.statusCode, error.message);
      }

      console.error('Unhandled API error:', error);
      return serverError('An unexpected error occurred');
    }
  };
}

// ============================================================================
// Request Body Validation
// ============================================================================

export async function getJsonBody<T>(request: Request): Promise<T> {
  try {
    return await request.json();
  } catch (error) {
    throw new ApiError(400, 'Invalid JSON body');
  }
}

export async function getValidatedBody<T>(
  request: Request,
  validator: (data: unknown) => data is T,
): Promise<T> {
  const body = await getJsonBody(request);
  if (!validator(body)) {
    throw new ApiError(400, 'Invalid request body');
  }
  return body;
}
