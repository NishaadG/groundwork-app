"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/components/providers/app-providers";
import { getProfile, type Profile, type ProfileFields, updateProfile } from "@/lib/api";

export const PROFILE_KEY = ["me"] as const;

export function useProfile() {
  const { state } = useAuth();
  return useQuery({
    queryKey: [...PROFILE_KEY, state.user?.sub],
    queryFn: getProfile,
    enabled: state.status === "signed_in",
  });
}

/** Saves profile fields, updating the cached profile with the server's answer. */
export function useSaveProfile() {
  const qc = useQueryClient();
  const { state } = useAuth();
  return useMutation({
    mutationFn: (fields: ProfileFields) => updateProfile(fields),
    onSuccess: (profile: Profile) => {
      qc.setQueryData([...PROFILE_KEY, state.user?.sub], profile);
    },
  });
}
