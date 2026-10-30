import { z } from '@workspace/zod'

const groupCount = 8

/** The eight 16-bit groups of an IPv6 address; its IPv4 tail, when written, counts as two groups. */
function groupsOf(address: string): number[] {
  const tail = address.slice(address.lastIndexOf(':') + 1)
  const octets = tail.includes('.') ? tail.split('.').map(Number) : []
  const text =
    octets.length === 4
      ? `${address.slice(0, address.length - tail.length)}${(((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16)}:${(((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16)}`
      : address
  const [head = '', rest] = text.split('::')
  const front = head === '' ? [] : head.split(':')
  const back = rest === undefined || rest === '' ? [] : rest.split(':')
  const zeros =
    rest === undefined
      ? []
      : Array.from({ length: groupCount - front.length - back.length }, () => '0')

  return [...front, ...zeros, ...back].map((group) => Number.parseInt(group, 16))
}

/** The key an address is counted under: an IPv4 address as it is, an IPv6 address by its /64. */
export function addressKey(address: string): string {
  if (!z.ipv6().safeParse(address).success) {
    return address
  }

  const groups = groupsOf(address)
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = groups
  const mapped = a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xff_ff

  if (mapped) {
    return [g >> 8, g & 0xff, h >> 8, h & 0xff].join('.')
  }

  return `${[a, b, c, d].map((group) => group.toString(16)).join(':')}::/64`
}
