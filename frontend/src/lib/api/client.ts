/**
 * Knowledge AI — Axios API Client
 * Centralized HTTP client with error handling.
 */
import axios, { AxiosError } from 'axios';
import { API_BASE } from '@/config/constants';

export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Structured API error */
export interface ApiError {
  message: string;
  status: number;
  detail?: string;
}

/** Map API errors to user-friendly messages */
function mapError(error: AxiosError<{ detail?: string }>): ApiError {
  const status = error.response?.status ?? 0;
  const detail = error.response?.data?.detail;

  const messages: Record<number, string> = {
    400: 'Invalid request. Please check your input.',
    404: 'The requested resource was not found.',
    409: detail ?? 'A conflict occurred. The resource may already exist.',
    413: 'File is too large. Please upload a smaller file.',
    422: detail ?? 'The data provided is invalid.',
    429: 'Too many requests. Please wait a moment.',
    500: 'An internal error occurred. Please try again.',
    502: 'The service is temporarily unavailable.',
    503: 'The service is under maintenance. Please try later.',
  };

  return {
    message: messages[status] ?? detail ?? 'An unexpected error occurred.',
    status,
    detail: detail ?? error.message,
  };
}

/** Response interceptor for centralized error handling */
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ detail?: string }>) => {
    const apiError = mapError(error);
    return Promise.reject(apiError);
  },
);
