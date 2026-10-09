/** Typed access to the synced copy of services/api/app/data/constants.json. */
import data from "./data/constants.json";

export interface Constant<T> {
  label: string;
  value: T;
  unit: string;
  source: string;
  source_url: string | null;
  as_of: string;
  status: "verified" | "estimate" | "assumption";
}

type Raw = typeof data.constants;

export interface Constants {
  pm_surya_ghar_subsidy: Constant<{
    first_2_kw_inr_per_kw: number;
    third_kw_inr_per_kw: number;
    cap_inr: number;
  }>;
  grid_emission_factor: Constant<number>;
  roof_area_per_kw: Constant<number>;
  performance_ratio: Constant<number>;
  shading_factor: Constant<{ none: number; partial: number; heavy: number }>;
  panel_degradation: Constant<number>;
  tariff_escalation_default: Constant<number>;
  analysis_years: Constant<number>;
  solar_cost_benchmark: Constant<{ kw: number; inr: number }[]>;
}

export const CONSTANTS = data.constants as Raw as unknown as Constants;

export type ConstantKey = keyof Constants;
