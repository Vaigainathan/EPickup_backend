const {
  NotificationTemplateProcessor,
  NotificationBuilder
} = require('../src/services/notificationTemplates');

const UTC_INSTANT = '2026-11-24T11:27:00.000Z';
const IST_DATE = new Date(UTC_INSTANT);

function expectIstTimeString(result) {
  const lower = String(result).toLowerCase();
  expect(lower).toMatch(/4:57/);
  expect(lower).toMatch(/pm/);
}

describe('notification time zone (Asia/Kolkata)', () => {
  test('formatNotificationTime formats Date, ISO string, and Firestore Timestamp in IST', () => {
    expectIstTimeString(NotificationBuilder.formatNotificationTime(IST_DATE));
    expectIstTimeString(NotificationBuilder.formatNotificationTime(UTC_INSTANT));
    expectIstTimeString(
      NotificationBuilder.formatNotificationTime({
        toDate: () => new Date(UTC_INSTANT)
      })
    );
  });

  test('formatNotificationVariableValue formats eta via substituteVariables in IST', () => {
    expectIstTimeString(
      NotificationTemplateProcessor.substituteVariables('ETA {{eta}}', { eta: IST_DATE })
    );
    expectIstTimeString(
      NotificationTemplateProcessor.substituteVariables('ETA {{eta}}', { eta: UTC_INSTANT })
    );
    expectIstTimeString(
      NotificationTemplateProcessor.substituteVariables('ETA {{eta}}', {
        eta: { toDate: () => new Date(UTC_INSTANT) }
      })
    );
  });

  test('numeric minutes still return "N mins" style output', () => {
    expect(NotificationBuilder.formatNotificationTime(15)).toBe('15 mins');
    expect(
      NotificationTemplateProcessor.substituteVariables('ETA {{eta}}', { eta: 15 })
    ).toBe('ETA 15 mins');
  });
});