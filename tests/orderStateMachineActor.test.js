const { assertTransition, InvalidStateError } = require('../src/services/marketplace/orderStateMachine');

describe('orderStateMachine handed_over actor', () => {
  test('shop actor cannot transition ready to handed_over', () => {
    expect(() => assertTransition('ready', 'handed_over', { actor: { type: 'shop', id: 's1' } }))
      .toThrow(InvalidStateError);
  });

  test('driver and system actors can transition ready to handed_over', () => {
    expect(() => assertTransition('ready', 'handed_over', { actor: { type: 'driver', id: 'd1' } }))
      .not.toThrow();
    expect(() => assertTransition('ready', 'handed_over', { actor: { type: 'system', id: 'sync' } }))
      .not.toThrow();
  });
});
