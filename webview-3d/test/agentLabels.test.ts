import { expect, test } from 'vitest';

import { labelsReducer } from '../src/agents/agentLabels.js';

test('agentLabel sets and replaces a session label', () => {
  const a = labelsReducer({}, { type: 'agentLabel', id: 2, label: 'brain setup' });
  expect(a).toEqual({ 2: 'brain setup' });
  expect(labelsReducer(a, { type: 'agentLabel', id: 2, label: 'ledger audit' })).toEqual({
    2: 'ledger audit',
  });
});

test('an identical label returns the same object so React does not re-render', () => {
  const a = labelsReducer({}, { type: 'agentLabel', id: 2, label: 'brain setup' });
  expect(labelsReducer(a, { type: 'agentLabel', id: 2, label: 'brain setup' })).toBe(a);
});

test('a closed agent loses its label; unrelated messages change nothing', () => {
  const a = { 2: 'brain setup', 3: 'ledger audit' };
  expect(labelsReducer(a, { type: 'agentClosed', id: 2 })).toEqual({ 3: 'ledger audit' });
  expect(labelsReducer(a, { type: 'agentClosed', id: 9 })).toBe(a);
  expect(labelsReducer(a, { type: 'agentStatus', id: 2, status: 'waiting' })).toBe(a);
});
