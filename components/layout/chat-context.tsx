"use client";

import { createContext, useContext, useEffect, useState } from "react";

type ChatContextValue = {
  chatOpen: boolean;
  toggleChat: () => void;
};

const ChatContext = createContext<ChatContextValue>({
  chatOpen: false,
  toggleChat: () => {},
});

const STORAGE_KEY = "portco_chat_panel_v2";

export function ChatContextProvider({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "open") setChatOpen(true);
    } catch { /* ignore */ }
  }, []);

  function toggleChat() {
    setChatOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, next ? "open" : "collapsed"); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <ChatContext.Provider value={{ chatOpen, toggleChat }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  return useContext(ChatContext);
}
