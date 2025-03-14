// Deno types
declare module "std/http/server.ts" {
  export interface ServeInit {
    port?: number;
    hostname?: string;
    handler?: (request: Request) => Response | Promise<Response>;
    onError?: (error: unknown) => Response | Promise<Response>;
    onListen?: (params: { hostname: string; port: number }) => void;
  }

  export function serve(
    handler: (request: Request) => Response | Promise<Response>,
    options?: ServeInit
  ): void;
}

declare module "puppeteer" {
  interface ElementHandle<T = HTMLElement> {
    evaluate<U>(
      pageFunction: (element: T, ...args: any[]) => U | Promise<U>,
      ...args: any[]
    ): Promise<U>;
    $$(selector: string): Promise<ElementHandle[]>;
    $(selector: string): Promise<ElementHandle | null>;
  }

  interface Page {
    setUserAgent(userAgent: string): Promise<void>;
    setViewport(viewport: { width: number; height: number }): Promise<void>;
    goto(
      url: string,
      options?: { timeout?: number; waitUntil?: string }
    ): Promise<void>;
    waitForSelector(
      selector: string,
      options?: { timeout?: number }
    ): Promise<ElementHandle>;
    $$(selector: string): Promise<ElementHandle[]>;
    $(selector: string): Promise<ElementHandle | null>;
    evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
    evaluate<T, U>(fn: (arg: T) => U | Promise<U>, arg: T): Promise<U>;
  }

  interface Browser {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  interface LaunchOptions {
    headless?: boolean;
  }

  const puppeteer: {
    launch(options?: LaunchOptions): Promise<Browser>;
  };

  export { ElementHandle, Page, Browser };
  export default puppeteer;
}

// Global types
declare interface ElementInfo {
  tagName: string;
  id: string;
  classes: string[];
  attributes: Record<string, string>;
  textContent: string;
  innerHtml: string;
  xpath: string;
  selector: string;
  role?: string;
  type?: string;
  name?: string;
}
