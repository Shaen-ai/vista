"use client";

import { useState } from "react";

interface FaqAccordionProps {
  questions: Array<{ question: string; answer: string }>;
}

export function FaqAccordion({ questions }: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="divide-y divide-[var(--border)]">
      {questions.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div key={item.question}>
            <button
              type="button"
              className="flex w-full items-center justify-between py-5 text-left"
              onClick={() => setOpenIndex(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-controls={`vista-faq-answer-${i}`}
            >
              <span className="text-sm font-semibold text-[var(--foreground)] sm:text-base">
                {item.question}
              </span>
              <span className="ml-4 shrink-0 text-[var(--muted-foreground)]">
                {isOpen ? "−" : "+"}
              </span>
            </button>
            <div
              id={`vista-faq-answer-${i}`}
              className={
                isOpen
                  ? "pb-5 text-sm leading-relaxed text-[var(--muted-foreground)]"
                  : "sr-only pb-0 text-sm leading-relaxed text-[var(--muted-foreground)]"
              }
              aria-hidden={!isOpen}
            >
              {item.answer}
            </div>
          </div>
        );
      })}
    </div>
  );
}
