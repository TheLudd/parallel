/* eslint-disable max-classes-per-file */
import FL from 'fantasy-land'
import { of } from '@theludd/fantasy-functions'

function push (val, array) {
  const len = array.length
  const out = new Array(len + 1)
  out[len] = val
  for (let i = len - 1; i >= 0; i -= 1) {
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

function findNextAction (steps, tupleIndex) {
  let nextAction
  do {
    nextAction = steps.shift()[tupleIndex]
  } while (nextAction == null && steps.length > 0)
  return nextAction
}

function processSteps (originalParallel, steps) {
  return function _drain (reject, resolve) {
    let currentParallel = originalParallel
    let currentParallelIsResolved
    let isSync = true

    function makeStep (tupleIndex) {
      return function step (v) {
        currentParallelIsResolved = true
        const nextAction = findNextAction(steps, tupleIndex)
        if (nextAction != null) {
          currentParallel = nextAction(v)
        } else {
          // eslint-disable-next-line no-use-before-define
          currentParallel = tupleIndex === 0 ? Parallel.reject(v) : parallelOf(v)
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

function safeFork (fork) {
  return (reject, resolve) => {
    let isPristine = true
    function callIfPristine (fn) {
      return (v) => {
        if (isPristine) {
          isPristine = false
          fn(v)
        }
      }
    }
    fork(callIfPristine(reject), callIfPristine(resolve))
  }
}

class Parallel {
  constructor (fork) {
    this.fork = safeFork(fork)
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

      function handleValueResolve (v) {
        val = v
        resolveIfDone()
      }

      function handeFnResolve (fn) {
        applyFn = fn
        resolveIfDone()
      }

      this.fork(rejectIfFirst, handleValueResolve)
      b.fork(rejectIfFirst, handeFnResolve)
    })
  }

  rejectMap (f) {
    return createSequence(this, (e) => Parallel.reject(f(e)), null)
  }

  rejectChain (f) {
    return createSequence(this, f, null)
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

  rejectMap () {
    return this
  }

  rejectChain () {
    return this
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
    return createSequence(this, f, null)
  }
}

Parallel[FL.of] = (v) => new ResolvedParallel(v)
Parallel.reject = (v) => new RejectedParallel(v)

const parallelOf = of(Parallel)

export default Parallel
