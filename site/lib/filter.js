import { paramCase } from '../../src/lib/utils.js';

// Lowercased text to find an option by: its label, name, CLI flag, and description, without markup

/**
 * @param {{id: string, label: string, helpText?: string}} option
 * @returns {string}
 */
export const optionFilterText = ({ id, label, helpText = '' }) => [label, id, `--${paramCase(id)}`, helpText]
  .join(' ')
  .replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .toLowerCase();

// Whether text holds every word of a query, in any order (a blank query matches all)

/**
 * @param {string} text
 * @param {string} query
 * @returns {boolean}
 */
export const matchesFilter = (text, query) => query
  .toLowerCase()
  .split(/\s+/)
  .every(word => text.includes(word));

// IDs of the options whose choice differs between two lists of the same options, in the same order

/**
 * @param {{id: string, checked?: boolean, value?: string | number}[]} before
 * @param {{id: string, checked?: boolean, value?: string | number}[]} after
 * @returns {string[]}
 */
export const changedOptionIds = (before, after) => after
  .filter((option, i) => option.checked !== before[i].checked || String(option.value) !== String(before[i].value))
  .map(option => option.id);