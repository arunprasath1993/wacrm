import { describe, expect, it } from 'vitest'
import { extractStandbyInbound } from './standby'

const metadata = { display_phone_number: '91 90000 00000', phone_number_id: 'pn1' }
const tap = {
  id: 'wamid.T1',
  from: '917358638098',
  timestamp: '1700000000',
  type: 'button',
  button: { text: 'Book Free Demo', payload: 'Book Free Demo' },
}
const contact = { wa_id: '917358638098', profile: { name: 'Arun' } }

describe('extractStandbyInbound', () => {
  it('reads an array of message objects', () => {
    const r = extractStandbyInbound({ metadata, contacts: [contact], standby: [tap] })
    expect(r.messages).toEqual([tap])
    expect(r.contacts).toEqual([contact])
  })

  it('reads value-like envelopes', () => {
    const r = extractStandbyInbound({
      metadata,
      standby: [{ messages: [tap], contacts: [contact] }],
    })
    expect(r.messages).toEqual([tap])
    expect(r.contacts).toEqual([contact])
  })

  it('reads single-message envelopes and a non-array standby', () => {
    expect(extractStandbyInbound({ metadata, standby: { message: tap } }).messages).toEqual([tap])
    expect(extractStandbyInbound({ metadata, standby: tap }).messages).toEqual([tap])
  })

  it('drops agent / business echoes', () => {
    const echo = { ...tap, id: 'wamid.E1', to: '917358638098', from: '919000000000' }
    const fromBusiness = { ...tap, id: 'wamid.E2', from: '919000000000' }
    const noSender = { id: 'wamid.E3', type: 'text' }
    const r = extractStandbyInbound({ metadata, standby: [echo, fromBusiness, noSender, tap] })
    expect(r.messages.map((m) => (m as { id: string }).id)).toEqual(['wamid.T1'])
  })

  it('returns nothing for a value without standby', () => {
    expect(extractStandbyInbound({ metadata, messages: [tap] }).messages).toEqual([])
    expect(extractStandbyInbound(null).messages).toEqual([])
  })
})
