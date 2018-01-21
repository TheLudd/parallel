import FL from 'fantasy-land'
import { of } from '@theludd/fantasy-functions'

function push (val, array) {
  const length = array.length
  const out = new Array(length + 1)
  out[length] = val
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = array[i]
  }
  return out
}

function createSequence (current, nextReject, nextResolve) {
  const steps = current.steps || []
  const original = current.original || current
  const nextTuple = [ nextReject, nextResolve ]
  const newSteps = push(nextTuple, steps)
  // eslint-disable-next-line no-use-before-define
  return new Sequence(original, newSteps)
}

function processSteps (originalParallel, steps) {
  return function _drain (reject, resolve) {
    let currentParallel = originalParallel
    let currentParallelIsResolved
    let isSync = true

    function makeStep (tupleIndex) {
      return function step (v) {
        currentParallelIsResolved = true
        const nextAction = steps.shift()[tupleIndex]
        if (nextAction != null) {
          currentParallel = nextAction(v)
        }
        if (!isSync) {
          // eslint-disable-next-line no-use-before-define
          drainUntilEmptyOrAsync()
        }
      }
    }
    const innerResolve = makeStep(1)
    const innerReject = makeStep(0)

    function drainUntilEmptyOrAsync () {
      isSync = true
      while (isSync && steps.length > 0) {
        currentParallelIsResolved = false
        currentParallel.fork(innerReject, innerResolve)
        isSync = currentParallelIsResolved
      }
      if (steps.length === 0) {
        currentParallel.fork(reject, resolve)
      }
    }

    drainUntilEmptyOrAsync()
  }
}

class Parallel {

  constructor (fork) {
    this.fork = fork
  }

  [FL.map] (f) {
    // eslint-disable-next-line no-use-before-define
    return createSequence(this, null, (v) => parallelOf(f(v)))
  }

  [FL.chain] (f) {
    return createSequence(this, null, f)
  }

  [FL.ap] (b) {
    return new Parallel((reject, resolve) => {
      let applyFn
      let val
      let wasRejected = false

      function resolveIfDone () {
        if (applyFn != null && val != null) {
          resolve(applyFn(val))
        }
      }

      function rejectIfFirst (e) {
        if (!wasRejected) {
          wasRejected = true
          reject(e)
        }
      }

      this.fork(rejectIfFirst, (v) => {
        val = v
        resolveIfDone()
      })

      b.fork(rejectIfFirst, (v) => {
        applyFn = v
        resolveIfDone()
      })
    })
  }

  rejectMap () {
    return this
  }

  rejectChain () {
    return this
  }

}

class Sequence extends Parallel {

  constructor (original, steps) {
    super(processSteps(original, steps))
    this.original = original
    this.steps = steps
  }

}

class ResolvedParallel extends Parallel {

  constructor (v) {
    super((_, resolve) => resolve(v))
    this.value = v
  }

  [FL.map] (f) {
    return new ResolvedParallel(f(this.value))
  }

}

class RejectedParallel extends Parallel {

  constructor (v) {
    super((reject) => reject(v))
    this.value = v
  }

  [FL.map] () {
    return this
  }

  [FL.chain] () {
    return this
  }

  [FL.ap] () {
    return this
  }

  rejectMap (f) {
    return new RejectedParallel(f(this.value))
  }

  rejectChain (f) {
    return createSequence(this, (e) => f(e), null)
  }

}

Parallel[FL.of] = (v) => new ResolvedParallel(v)
Parallel.reject = (v) => new RejectedParallel(v)

const parallelOf = of(Parallel)

export default Parallel
