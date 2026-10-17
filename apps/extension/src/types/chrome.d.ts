// Ambient declarations for the Chrome Extension API (chrome.*).
// Kept minimal: the runtime/storage/tabs/sidePanel surfaces the extension uses.

declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: { id?: number; url?: string }
    }
    interface OnMessage {
      addListener(
        cb: (message: any, sender: MessageSender, sendResponse: (response?: any) => void) => boolean | void
      ): void
      removeListener(cb: any): void
    }
    const onMessage: OnMessage
    function sendMessage(message: any, responseCallback?: (response: any) => void): void
  }
  namespace tabs {
    function sendMessage(tabId: number, message: any, responseCallback?: (response: any) => void): void
  }
  namespace storage {
    namespace local {
      function get(key: string, callback: (result: any) => void): void
      function set(items: { [key: string]: any }, callback?: () => void): void
    }
  }
  namespace sidePanel {
    function setOptions(options: { path?: string }): void
  }
}

declare const chrome: any
