/*
 * src/main.js — boot: the one page's entry point (REWRITE-PLAN.md Phase 4).
 *
 * The classic scripts before this module have put the core, the data layer
 * and the services on window.FDCore / FDData / FDServices. This opens the
 * database (migrating the legacy ones first, with the dialog, on a profile
 * that still has them), then starts the shell, which mounts each feature into
 * its panel on first use.
 */
import { boot } from "./shell/index.js";

boot();
