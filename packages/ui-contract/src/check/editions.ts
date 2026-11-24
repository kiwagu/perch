/**
 * Editions: a rule of the contract belongs to the version of the format that brought it. A
 * contract is read by the version its `platform.yaml` declares, so a rule of version N applies to
 * a contract at N or later and never to an older one, which loads and checks as it did before:
 * such a rule starts with `if (!since(contract, N)) return []`.
 */

import type { Contract } from './contract'

/** The version a contract is written in: the one its `platform.yaml` declares. */
export const editionOf = (contract: Contract): number => contract.screens.version

/** Whether the rules of version `edition` apply: the contract is at that version or a later one. */
export const since = (contract: Contract, edition: number): boolean =>
  editionOf(contract) >= edition
