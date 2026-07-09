"use client";

import { useState } from "react";

interface FaqAccordionProps {
  questions: Array<{ question: string; answer: string }>;
}

export function FaqAccordion({ questions }: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="divide-y divide-[var(--border)]">
      {questions.map((item, i) => (
        <div key={i}>
          <button
            type="button"
            className="flex w-full items-center justify-between py-5 text-left"
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            aria-expanded={openIndex === i}
          >
            <span className="text-sm font-semibold text-[var(--foreground)] sm:text-base">
              {item.question}
            </span>
            <span className="ml-4 shrink-0 text-[var(--muted-foreground)]">
              {openIndex === i ? "−" : "+"}
            </span>
          </button>
          {openIndex === i && (
            <p className="pb-5 text-sm leading-relaxed text-[var(--muted-foreground)]">
              {item.answer}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
