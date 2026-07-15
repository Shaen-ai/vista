"use client";

import { useCallback, useEffect, useState } from "react";
import { getAuthToken } from "@/lib/authApi";
import { useConsumerDesignStore } from "@/app/store";
import { fetchTokenBalance, syncVistaTokenBalance } from "@/lib/vistaTokens";
import { LowBalanceModal } from "@/components/LowBalanceModal";
import {
  isBelowLowBalanceThreshold,
  isLowBalanceEpisodeShown,
  markLowBalanceEpisodeShown,
  registerLowBalanceForceOpen,
  resetLowBalanceEpisode,
  resolveLowBalanceVariant,
  LOW_BALANCE_THRESHOLD,
  type LowBalanceVariant,
} from "@/lib/lowBalancePrompt";
import { track } from "@/lib/analytics";

export function LowBalancePrompt() {
  const tokenBalance = useConsumerDesignStore((s) => s.tokenBalance);
  const setTokenBalance = useConsumerDesignStore((s) => s.setTokenBalance);
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState<LowBalanceVariant>("topup");

  useEffect(() => {
    if (tokenBalance !== null) return;
    syncVistaTokenBalance()
      .then((data) => setTokenBalance(data.balance))
      .catch(() =>
        fetchTokenBalance()
          .then((data) => setTokenBalance(data.balance))
          .catch(() => {}),
      );
  }, [tokenBalance, setTokenBalance]);

  const showPrompt = useCallback(
    (bypassEpisode = false) => {
      if (!isBelowLowBalanceThreshold(tokenBalance)) return;

      if (!bypassEpisode && isLowBalanceEpisodeShown()) return;

      const nextVariant = resolveLowBalanceVariant(Boolean(getAuthToken()));
      setVariant(nextVariant);
      setOpen(true);
      markLowBalanceEpisodeShown();
      track("low_balance_prompt_shown", { variant: nextVariant, balance: tokenBalance });
    },
    [tokenBalance],
  );

  useEffect(() => {
    if (tokenBalance === null) return;

    if (tokenBalance >= LOW_BALANCE_THRESHOLD) {
      resetLowBalanceEpisode();
      setOpen(false);
      return;
    }

    showPrompt(false);
  }, [tokenBalance, showPrompt]);

  useEffect(() => {
    return registerLowBalanceForceOpen(() => showPrompt(true));
  }, [showPrompt]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <LowBalanceModal
      open={open}
      variant={variant}
      balance={tokenBalance}
      onClose={handleClose}
      onBalanceChange={setTokenBalance}
    />
  );
}
