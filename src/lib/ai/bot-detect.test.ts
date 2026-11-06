import { describe, it, expect } from 'vitest'
import { detectAutomatedSender } from './bot-detect'
import type { ChatMessage } from './types'

const user = (content: string): ChatMessage => ({ role: 'user', content })
const bot = (content: string): ChatMessage => ({ role: 'assistant', content })

describe('detectAutomatedSender', () => {
  it.each([
    'To make selection, please reply with the option number(eg: type ‘1’ for Contact Vi Support).',
    'I can assist only with Vi services and related queries.',
    'Press 2 to talk to our sales team',
    'Invalid option. Please select a valid option.',
    'This is an automated message, please do not reply to this message.',
    'This number is not monitored.',
    "Hi, I'm a virtual assistant for XYZ Bank.",
    'Sorry, I can only help with questions about your policy.',
    'Please reply with option no. 3',
    'Type "2" to speak to an agent',
  ])('flags bot phrasing: %s', (text) => {
    expect(detectAutomatedSender([user(text)])).not.toBeNull()
  })

  it.each([
    'hi',
    'What is the price of the RO purifier?',
    'Can you send me option 1 details please',
    'I want to book a demo tomorrow at 11',
    'reply fast please, I need it today',
    '1. kitchen 2. hall — need purifiers for both',
    'send 2 to Chennai please',
    'I will reply with no problem, sorry',
    'We need type 2 for the kitchen, what is the price?',
    'I want to make a selection from your range of purifiers',
  ])('treats a person as a person: %s', (text) => {
    expect(detectAutomatedSender([user(text)])).toBeNull()
  })

  it('flags the same long message sent repeatedly', () => {
    const canned = 'Thank you for contacting us, our executive will get back to you soon.'
    expect(
      detectAutomatedSender([user(canned), bot('Sure, how can I help?'), user(canned)]),
    ).toEqual({ reason: 'the same long message was sent repeatedly' })
  })

  it('ignores a person double-sending before we reply', () => {
    const long = 'Please call me back today, I need a purifier installed this week.'
    expect(detectAutomatedSender([user(long), user(long)])).toBeNull()
  })

  it('ignores an old repeat when the latest message is new', () => {
    const canned = 'Thank you for contacting us, our executive will get back to you soon.'
    expect(
      detectAutomatedSender([
        user(canned),
        bot('Sure, how can I help?'),
        user(canned),
        bot('Pausing here.'),
        user('Sorry, that was our auto-reply. What is the RO price?'),
      ]),
    ).toBeNull()
  })

  it('ignores short repeats people send naturally', () => {
    expect(detectAutomatedSender([user('hello?'), bot('Hi!'), user('hello?')])).toBeNull()
  })

  it('ignores bot phrasing in our own messages', () => {
    expect(
      detectAutomatedSender([bot('Please reply with the option number.'), user('2')]),
    ).toBeNull()
  })

  it('caps the current turn at the most recent customer messages', () => {
    const old = user('Invalid option. Please try again.')
    const recent = ['ok', 'thanks', 'price?', 'when can you come?'].map(user)
    expect(detectAutomatedSender([old, ...recent])).toBeNull()
  })

  it('does not re-flag an old bot message once we have replied (re-enable sticks)', () => {
    expect(
      detectAutomatedSender([
        user('Invalid option. Please select a valid option.'),
        bot('Hi! How can I help you today?'),
        user('I need a purifier for my kitchen'),
      ]),
    ).toBeNull()
  })

  it('returns null for an empty transcript', () => {
    expect(detectAutomatedSender([])).toBeNull()
  })
})
