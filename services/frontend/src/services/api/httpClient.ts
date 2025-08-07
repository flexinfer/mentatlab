/**
 * HTTP Client with interceptors for centralized API communication
 * Provides automatic auth, logging, error handling, and retry logic
 */

import { FeatureFlags } from '../../config/features';

export interface HttpConfig {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
    retryOn?: number[];
  };
}

export interface RequestConfig extends RequestInit {
  url: string;
  params?: Record<string, any>;
  data?: any;
  timeout?: number;
  retry?: boolean;
  _retryCount?: number;
}

export interface HttpInterceptor {
  request?: (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;
  response?: (response: Response) => Response | Promise<Response>;
  error?: (error: Error) => Promise<any>;
}

export class HttpClient {
  private config: HttpConfig;
  private interceptors: HttpInterceptor[] = [];
  private abortControllers: Map<string, AbortController> = new Map();
  
  // Public defaults property for configuration
  public defaults: {
    baseURL?: string;
    headers: {
      common: Record<string, string>;
      [key: string]: any;
    };
  };

  constructor(config: HttpConfig) {
    this.config = {
      timeout: 30000,
      retryConfig: {
        maxRetries: 3,
        retryDelay: 1000,
        retryOn: [408, 429, 500, 502, 503, 504],
      },
      ...config,
    };
    
    // Initialize defaults
    this.defaults = {
      baseURL: config.baseUrl,
      headers: {
        common: {},
        ...config.headers
      }
    };

    // Add default interceptors
    this.addDefaultInterceptors();
  }

  /**
   * Add request/response interceptor
   */
  addInterceptor(interceptor: HttpInterceptor): void {
    this.interceptors.push(interceptor);
  }

  /**
   * Remove interceptor
   */
  removeInterceptor(interceptor: HttpInterceptor): void {
    const index = this.interceptors.indexOf(interceptor);
    if (index > -1) {
      this.interceptors.splice(index, 1);
    }
  }

  /**
   * Perform GET request
   */
  async get<T = any>(url: string, config?: Partial<RequestConfig>): Promise<T> {
    return this.request<T>({ ...config, url, method: 'GET' });
  }

  /**
   * Perform POST request
   */
  async post<T = any>(url: string, data?: any, config?: Partial<RequestConfig>): Promise<T> {
    return this.request<T>({ ...config, url, method: 'POST', data });
  }

  /**
   * Perform PUT request
   */
  async put<T = any>(url: string, data?: any, config?: Partial<RequestConfig>): Promise<T> {
    return this.request<T>({ ...config, url, method: 'PUT', data });
  }

  /**
   * Perform DELETE request
   */
  async delete<T = any>(url: string, config?: Partial<RequestConfig>): Promise<T> {
    return this.request<T>({ ...config, url, method: 'DELETE' });
  }

  /**
   * Perform PATCH request
   */
  async patch<T = any>(url: string, data?: any, config?: Partial<RequestConfig>): Promise<T> {
    return this.request<T>({ ...config, url, method: 'PATCH', data });
  }

  /**
   * Cancel a request by URL
   */
  cancel(url: string): void {
    const controller = this.abortControllers.get(url);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(url);
    }
  }

  /**
   * Cancel all pending requests
   */
  cancelAll(): void {
    this.abortControllers.forEach(controller => controller.abort());
    this.abortControllers.clear();
  }

  /**
   * Main request method
   */
  private async request<T = any>(config: RequestConfig): Promise<T> {
    // Apply request interceptors
    let finalConfig = await this.applyRequestInterceptors(config);

    // Build full URL
    const url = this.buildUrl(finalConfig.url, finalConfig.params);

    // Create abort controller
    const abortController = new AbortController();
    this.abortControllers.set(finalConfig.url, abortController);

    // Set up timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, finalConfig.timeout || this.config.timeout);

    try {
      // Prepare request options
      const requestOptions: RequestInit = {
        ...finalConfig,
        signal: abortController.signal,
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
          ...this.defaults.headers.common,
          ...finalConfig.headers,
        },
      };

      // Add body if present
      if (finalConfig.data) {
        requestOptions.body = JSON.stringify(finalConfig.data);
      }

      // Make request
      let response = await fetch(url, requestOptions);

      // Apply response interceptors
      response = await this.applyResponseInterceptors(response);

      // Handle response
      if (!response.ok) {
        throw new HttpError(response.status, response.statusText, response);
      }

      // Parse response
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return await response.json();
      } else if (contentType?.includes('text/')) {
        return await response.text() as any;
      } else {
        return await response.blob() as any;
      }
    } catch (error) {
      // Handle retry logic
      if (this.shouldRetry(error as Error, finalConfig)) {
        return this.retryRequest<T>(finalConfig);
      }

      // Apply error interceptors
      throw await this.applyErrorInterceptors(error as Error);
    } finally {
      clearTimeout(timeoutId);
      this.abortControllers.delete(finalConfig.url);
    }
  }

  /**
   * Build full URL with query parameters
   */
  private buildUrl(url: string, params?: Record<string, any>): string {
    const baseUrl = this.defaults.baseURL || this.config.baseUrl;
    const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
    
    if (!params) return fullUrl;

    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    return queryString ? `${fullUrl}?${queryString}` : fullUrl;
  }

  /**
   * Apply request interceptors
   */
  private async applyRequestInterceptors(config: RequestConfig): Promise<RequestConfig> {
    let finalConfig = config;

    for (const interceptor of this.interceptors) {
      if (interceptor.request) {
        finalConfig = await interceptor.request(finalConfig);
      }
    }

    return finalConfig;
  }

  /**
   * Apply response interceptors
   */
  private async applyResponseInterceptors(response: Response): Promise<Response> {
    let finalResponse = response;

    for (const interceptor of this.interceptors) {
      if (interceptor.response) {
        finalResponse = await interceptor.response(finalResponse);
      }
    }

    return finalResponse;
  }

  /**
   * Apply error interceptors
   */
  private async applyErrorInterceptors(error: Error): Promise<any> {
    let finalError = error;

    for (const interceptor of this.interceptors) {
      if (interceptor.error) {
        try {
          return await interceptor.error(finalError);
        } catch (err) {
          finalError = err as Error;
        }
      }
    }

    throw finalError;
  }

  /**
   * Check if request should be retried
   */
  private shouldRetry(error: Error, config: RequestConfig): boolean {
    if (!this.config.retryConfig || config.retry === false) return false;

    const retryCount = config._retryCount || 0;
    if (retryCount >= this.config.retryConfig.maxRetries) return false;

    if (error instanceof HttpError && this.config.retryConfig.retryOn) {
      return this.config.retryConfig.retryOn.includes(error.status);
    }

    return error.name === 'AbortError';
  }

  /**
   * Retry request with exponential backoff
   */
  private async retryRequest<T>(config: RequestConfig): Promise<T> {
    const retryCount = (config._retryCount || 0) + 1;
    const delay = this.config.retryConfig!.retryDelay * Math.pow(2, retryCount - 1);

    console.log(`Retrying request to ${config.url} (attempt ${retryCount})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    return this.request<T>({
      ...config,
      _retryCount: retryCount,
    });
  }

  /**
   * Add default interceptors
   */
  private addDefaultInterceptors(): void {
    // Auth interceptor
    this.addInterceptor({
      request: (config) => {
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers = {
            ...config.headers,
            Authorization: `Bearer ${token}`,
          };
        }
        return config;
      },
    });

    // Logging interceptor
    if (FeatureFlags.NEW_API_LAYER) {
      this.addInterceptor({
        request: (config) => {
          console.log(`[HTTP] ${config.method} ${config.url}`, config);
          return config;
        },
        response: (response) => {
          console.log(`[HTTP] Response ${response.status}`, response);
          return response;
        },
        error: async (error) => {
          console.error('[HTTP] Error', error);
          throw error;
        },
      });
    }

    // Error transformation interceptor
    this.addInterceptor({
      error: async (error) => {
        if (error instanceof HttpError) {
          // Transform to user-friendly error messages
          switch (error.status) {
            case 401:
              throw new Error('Authentication required. Please log in.');
            case 403:
              throw new Error('You do not have permission to perform this action.');
            case 404:
              throw new Error('The requested resource was not found.');
            case 500:
              throw new Error('Server error. Please try again later.');
            default:
              throw error;
          }
        }
        throw error;
      },
    });
  }
}

/**
 * Custom HTTP error class
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public response: Response
  ) {
    super(`HTTP Error ${status}: ${statusText}`);
    this.name = 'HttpError';
  }
}

// Export singleton instance
export const httpClient = new HttpClient({
  baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});