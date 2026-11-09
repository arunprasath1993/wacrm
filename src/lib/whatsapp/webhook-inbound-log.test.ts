import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  inboundLogEnabled,
  outcomeRow,
  recordInboundLog,
  summarizeWebhook,
} from './webhook-inbound-log'

describe('inboundLogEnabled', () => {
  afterEach(() => {
    delete process.env.WEBHOOK_DEBUG_LOG
  })

  it('is off unless WEBHOOK_DEBUG_LOG is exactly "true"', () => {
    expect(inboundLogEnabled()).toBe(false)
    process.env.WEBHOOK_DEBUG_LOG = '1'
    expect(inboundLogEnabled()).toBe(false)
    process.env.WEBHOOK_DEBUG_LOG = 'true'
    expect(inboundLogEnabled()).toBe(true)
  })
})

describe('summarizeWebhook', () => {
  it('writes one row per change with the keys the value carried', () => {
    const rows = summarizeWebhook(
      {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: '1401131229749221' },
                  contacts: [{ wa_id: '919000000000' }],
                  messages: [
                    { id: 'wamid.A', type: 'text' },
                    { id: 'wamid.B', type: 'image' },
                  ],
                },
              },
              {
                field: 'smb_message_echoes',
                value: { metadata: { phone_number_id: '1401131229749221' } },
              },
            ],
          },
        ],
      },
      true,
    )

    expect(rows).toEqual([
      {
        signature_ok: true,
        field: 'messages',
        phone_number_id: '1401131229749221',
        message_id: 'wamid.A,wamid.B',
        message_type: 'text,image',
        status_count: 0,
        outcome: 'received',
        detail: 'contacts,messages,metadata',
      },
      expect.objectContaining({
        field: 'smb_message_echoes',
        message_id: null,
        detail: 'metadata',
      }),
    ])
  })

  it('appends referral fields to detail for a message with referral', () => {
    const rows = summarizeWebhook(
      {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'pn' },
                  messages: [
                    {
                      id: 'wamid.1',
                      type: 'text',
                      referral: {
                        source_type: 'ad',
                        source_id: '120',
                        source_url: 'https://fb.me/abc',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      true,
    )

    expect(rows[0].detail).toBe(
      'messages,metadata; referral[wamid.1]=source_type:ad|source_id:120|source_url:https://fb.me/abc',
    )
  })

  it('leaves detail unchanged when no message has a referral', () => {
    const rows = summarizeWebhook(
      {
        entry: [
          { changes: [{ field: 'messages', value: { messages: [{ id: 'wamid.1', type: 'text' }] } }] },
        ],
      },
      true,
    )

    expect(rows[0].detail).toBe('messages')
  })

  it('reads referral from standby-delivered messages', () => {
    const rows = summarizeWebhook(
      {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  standby: [
                    {
                      id: 'wamid.S',
                      type: 'text',
                      from: '919000000000',
                      referral: { source_type: 'post', source_id: '9', source_url: 'https://fb.me/p' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      true,
    )

    expect(rows[0].detail).toBe(
      'standby; referral[wamid.S]=source_type:post|source_id:9|source_url:https://fb.me/p',
    )
  })

  it('marks rows from a payload that failed its signature check', () => {
    const rows = summarizeWebhook(
      { entry: [{ changes: [{ field: 'messages', value: { statuses: [{}, {}] } }] }] },
      false,
    )

    expect(rows).toEqual([
      expect.objectContaining({
        signature_ok: false,
        outcome: 'bad_signature',
        status_count: 2,
        phone_number_id: null,
      }),
    ])
  })

  it('still yields a row for a body that is not a webhook envelope', () => {
    expect(summarizeWebhook(null, false)).toEqual([
      expect.objectContaining({ outcome: 'bad_signature', detail: 'no entry array' }),
    ])
    expect(summarizeWebhook({ entry: [] }, true)).toEqual([
      expect.objectContaining({ outcome: 'received', detail: 'no changes' }),
    ])
  })
})

describe('recordInboundLog', () => {
  it('swallows a failed insert so the webhook keeps going', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = {
      from: () => ({
        insert: () => Promise.resolve({ error: { message: 'relation does not exist' } }),
      }),
    }

    await expect(
      recordInboundLog(db as never, [outcomeRow({ phoneNumberId: 'pn', outcome: 'inserted' })]),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('swallows a thrown client error too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = {
      from: () => {
        throw new Error('network down')
      },
    }

    await expect(
      recordInboundLog(db as never, [outcomeRow({ phoneNumberId: null, outcome: 'process_error' })]),
    ).resolves.toBeUndefined()
    warn.mockRestore()
  })
})
