import {
  equal, fail, ifError, ok,
} from 'assert'
import { curry } from 'yafu'
import {
  ap, chain, map, of,
} from '@theludd/fantasy-functions'
import Parallel from '../lib/parallel'

describe('parallel', () => {
  function nextTick (val) {
    return new Parallel((_, resolve) => {
      process.nextTick(() => {
        resolve(val)
      })
    })
  }

  const nextTickCall = curry((f, val) => (
    new Parallel((_, resolve) => {
      process.nextTick(() => {
        resolve(f(val))
      })
    })
  ))

  function assertParallelValue (expected, parallel, done) {
    ok(parallel instanceof Parallel, 'result was not a parallel instance')
    const shoulBeSync = done == null
    let forkCount = 0
    let didFork = false
    parallel.fork((e) => {
      if (done) {
        done(e)
      } else {
        ifError(new Error(`Expected resolved value ${expected} but got rejected value ${e}`))
      }
    }, (v) => {
      forkCount += 1
      if (forkCount > 1) {
        ifError(new Error(`Error callback was called ${forkCount} times`))
      }
      didFork = true
      equal(v, expected)
      if (!shoulBeSync) {
        done()
      }
    })
    if (shoulBeSync) {
      ok(didFork, 'Parallel did not fork')
    }
  }

  function assertRejectedParallel (expected, parallel, done) {
    ok(parallel instanceof Parallel, 'result was not a parallel instance')
    const shoulBeSync = done == null
    let forkCount = 0
    let didFork = false
    parallel.fork((v) => {
      forkCount += 1
      if (forkCount > 1) {
        ifError(new Error(`Error callback was called ${forkCount} times`))
      }
      didFork = true
      equal(v, expected)
      if (!shoulBeSync) {
        done()
      }
    }, (result) => {
      ifError(new Error(`Expected rejected parallel but it was resolved with value ${result}`))
    })
    if (shoulBeSync) {
      ok(didFork, 'Parallel did not fork')
    }
  }

  const inc = (x) => x + 1
  const parallelOf = of(Parallel)
  const incChained = (x) => parallelOf(x + 1)
  const parallelOf1 = parallelOf(1)

  describe('.of', () => {
    it('should produce a resolving parallel', () => {
      assertParallelValue(1, parallelOf1)
    })
  })

  describe('.reject', () => {
    it('should produce a rejected parallel', () => {
      assertRejectedParallel('someRejection', Parallel.reject('someRejection'))
    })
  })

  describe('#map', () => {
    it('should return a new parallel mapped to the existing value', () => {
      assertParallelValue(2, map(inc, parallelOf1))
    })

    it('should ignore rejections', () => {
      assertRejectedParallel('someRejection', map(inc, Parallel.reject('someRejection')))
    })

    it('should return chain rejections', () => {
      const chainFn = (v) => Parallel.reject(`error from ${v}`)
      const input = chain(chainFn, parallelOf('input'))
      assertRejectedParallel('error from input', input)
    })

    it('should return independent parallels', () => {
      const original = map(inc, new Parallel((_, res) => res(0)))
      const plus2 = map(inc, original)
      const plus3 = map(inc, map(inc, original))
      assertParallelValue(2, plus2)
      assertParallelValue(3, plus3)
    })
  })

  describe('#chain', () => {
    it('should return a new parallel chained from the existing value', () => {
      assertParallelValue(2, chain(incChained, parallelOf(1)))
    })

    it('should ignore rejections', () => {
      function incRejected (v) {
        return Parallel.reject(v + 1)
      }
      const result = chain(
        incChained,
        chain(incRejected, parallelOf(1)),
      )
      assertRejectedParallel(2, result)
    })
  })

  describe('#ap', () => {
    it('should apply the value in a to the function in b', () => {
      const a = parallelOf(10)
      const b = parallelOf(inc)
      const result = ap(b, a)
      assertParallelValue(11, result)
    })

    it('should return return the error in a if a is rejected', () => {
      const a = Parallel.reject('error')
      const b = parallelOf(inc)
      const result = ap(b, a)
      assertRejectedParallel('error', result)
    })

    it('should return return the error in b if b is rejected', () => {
      const a = parallelOf(1)
      const b = Parallel.reject('error')
      const result = ap(b, a)
      assertRejectedParallel('error', result)
    })

    it('should only reject once', (done) => {
      const a = new Parallel((rej) => rej('first'))
      const b = new Parallel((rej) => rej('second'))
      const result = ap(b, a)
      assertRejectedParallel('first', result, done)
    })
  })

  describe('#rejectMap', () => {
    it('should return the same instance of a non rejected parallel', () => {
      const f1 = parallelOf(1)
      const f2 = f1.rejectMap(inc)
      assertParallelValue(1, f2)
    })

    it('should return a new parallel mapped to the rejected value', () => {
      const f1 = Parallel.reject(1)
      const f2 = f1.rejectMap(inc)
      assertRejectedParallel(2, f2)
    })
  })

  describe('#rejectChain', () => {
    it('should return the same instance of a non rejected parallel', () => {
      const f1 = parallelOf(1)
      const f2 = f1.rejectChain(incChained)
      assertParallelValue(1, f2)
    })

    it('should return a new parallel chained', () => {
      const f1 = Parallel.reject(1)
      const f2 = f1.rejectChain((e) => Parallel.reject(e + 1))
      assertRejectedParallel(2, f2)
    })

    it('should be able to turn rejected parallels to resolved ones', () => {
      const f1 = Parallel.reject(1)
      const f2 = f1.rejectChain(incChained)
      assertParallelValue(2, f2)
    })
  })

  describe('async -', () => {
    it('map', (done) => {
      const parallel = map(inc, nextTick(1))
      assertParallelValue(2, parallel, done)
    })

    it('chain', (done) => {
      const parallel = chain(incChained, nextTick(1))
      assertParallelValue(2, parallel, done)
    })

    it('chain with async function', (done) => {
      const parallel = chain(nextTickCall(inc), nextTick(4))
      assertParallelValue(5, parallel, done)
    })
  })

  describe('stack safety -', () => {
    function testStack (initial, getNextFn, done) {
      const rounds = 10000
      try {
        let parallel = initial
        for (let i = 0; i < rounds; i += 1) {
          parallel = getNextFn(parallel)
        }
        assertParallelValue(rounds, parallel, done)
      } catch (e) {
        if (e instanceof RangeError) {
          fail('', '', `${rounds} rounds of mapping blew the stack`)
        }
        ifError(e)
      }
    }

    it('map', () => {
      testStack(parallelOf(0), (f) => map(inc, f))
    })

    it('chain', () => {
      testStack(parallelOf(0), (f) => chain(incChained, f))
    })

    it('chain async', (done) => {
      testStack(nextTick(0), (f) => chain(nextTickCall(inc), f), done)
    })

    it('chain then map', (done) => {
      const parallel = nextTick(0)
      testStack(parallel, (f) => map(inc, f), done)
    })

    it('intertwined', (done) => {
      const getNext = (f) => chain(nextTickCall((x) => x), map(inc, f))
      testStack(parallelOf(0), getNext, done)
    })

    it.skip('ap', () => {
      const getNext = (f) => ap(parallelOf(inc), f)
      testStack(parallelOf(0), getNext)
    })

    it.skip('ap async', (done) => {
      const getNext = (f) => ap(nextTick(inc), f)
      testStack(parallelOf(0), getNext, done)
    })
  })
})
