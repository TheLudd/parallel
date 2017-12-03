import { equal, fail, ifError, ok } from 'assert'
import { curry } from 'yafu'
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
    parallel.fork(null, (v) => {
      forkCount += 1
      if (forkCount > 1) {
        ifError(new Error(`Error callback was called ${forkCount} times`))
      }
      didFork = true
      equal(expected, v)
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
      equal(expected, v)
      if (!shoulBeSync) {
        done()
      }
    })
    if (shoulBeSync) {
      ok(didFork, 'Parallel did not fork')
    }
  }

  const inc = (x) => x + 1
  const incChained = (x) => Parallel.of(x + 1)

  describe('.of', () => {
    it('should produce a resolving parallel', () => {
      assertParallelValue(1, Parallel.of(1))
    })
  })

  describe('.reject', () => {
    it('should produce a rejected parallel', () => {
      assertRejectedParallel('someRejection', Parallel.reject('someRejection'))
    })
  })

  describe('#map', () => {
    it('should return a new parallel mapped to the existing value', () => {
      assertParallelValue(2, Parallel.of(1).map(inc))
    })

    it('should ignore rejections', () => {
      assertRejectedParallel('someRejection', Parallel.reject('someRejection').map(inc))
    })

    it('should return chain rejections', () => {
      const chainFn = (v) => Parallel.reject(`error from ${v}`)
      const input = Parallel.of('input').chain(chainFn)
      assertRejectedParallel('error from input', input)
    })

    it('should return independent parallels', () => {
      const original = new Parallel((_, res) => res(0)).map(inc)
      const plus2 = original.map(inc)
      const plus3 = original.map(inc).map(inc)
      assertParallelValue(2, plus2)
      assertParallelValue(3, plus3)
    })
  })

  describe('#chain', () => {
    it('should return a new parallel chained from the existing value', () => {
      assertParallelValue(2, Parallel.of(1).chain(incChained))
    })

    it('should ignore rejections', () => {
      assertRejectedParallel('someRejection', Parallel.reject('someRejection').chain(incChained))
    })
  })

  describe('#ap', () => {
    it('should apply the value in a to the function in b', () => {
      const a = Parallel.of(10)
      const b = Parallel.of(inc)
      const result = a.ap(b)
      assertParallelValue(11, result)
    })

    it('should return return the error in a if a is rejected', () => {
      const a = Parallel.reject('error')
      const b = Parallel.of(inc)
      const result = a.ap(b)
      assertRejectedParallel('error', result)
    })

    it('should return return the error in b if b is rejected', () => {
      const a = Parallel.of(1)
      const b = Parallel.reject('error')
      const result = a.ap(b)
      assertRejectedParallel('error', result)
    })

    it('should only reject once', (done) => {
      const a = new Parallel((rej) => rej('first'))
      const b = new Parallel((rej) => rej('second'))
      const result = a.ap(b)
      assertRejectedParallel('first', result, done)
    })
  })

  describe('#rejectMap', () => {
    it('should return the same instance of a non rejected parallel', () => {
      const f1 = Parallel.of(1)
      const f2 = f1.rejectMap(inc)
      equal(f1, f2)
    })

    it('should return a new parallel mapped to the rejected value', () => {
      const f1 = Parallel.reject(1)
      const f2 = f1.rejectMap(inc)
      assertRejectedParallel(2, f2)
    })
  })

  describe('#rejectChain', () => {
    it('should return the same instance of a non rejected parallel', () => {
      const f1 = Parallel.of(1)
      const f2 = f1.rejectChain(incChained)
      equal(f1, f2)
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
      const parallel = nextTick(1).map(inc)
      assertParallelValue(2, parallel, done)
    })

    it('chain', (done) => {
      const parallel = nextTick(1).chain(incChained)
      assertParallelValue(2, parallel, done)
    })

    it('chain with async function', (done) => {
      const parallel = nextTick(4).chain(nextTickCall(inc))
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
      testStack(Parallel.of(0), (f) => f.map(inc))
    })

    it('chain', () => {
      testStack(Parallel.of(0), (f) => f.chain(incChained))
    })

    it('chain async', (done) => {
      testStack(nextTick(0), (f) => f.chain(nextTickCall(inc)), done)
    })

    it('chain then map', (done) => {
      const parallel = nextTick(0)
      testStack(parallel, (f) => f.map(inc), done)
    })

    it('intertwined', (done) => {
      const getNext = (f) => f.chain(nextTickCall((x) => x)).map(inc)
      testStack(Parallel.of(0), getNext, done)
    })

    it('ap', () => {
      const getNext = (f) => f.ap(Parallel.of(inc))
      testStack(Parallel.of(0), getNext)
    })

    it('ap async', (done) => {
      const getNext = (f) => f.ap(nextTick(inc))
      testStack(Parallel.of(0), getNext, done)
    })
  })
})

