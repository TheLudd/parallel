function push (val, array) {
  const length = array.length
  const out = new Array(length + 1)
  out[length] = val
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = array[i]
  }
  return out
}

function createSequence (current, nextStep) {
  const steps = current.steps || []
  const original = current.original || current
  const newSteps = push(nextStep, steps)
  // eslint-disable-next-line no-use-before-define
  return new Sequence(original, newSteps)
}

function processSteps (originalParallel, steps) {
  return function _drain (reject, resolve) {
    let currentParallel = originalParallel
    let currentParallelIsResolved
    let nextAction
    let isSync = true
    let isRejected = false

    function innnerResolve (v) {
      currentParallelIsResolved = true
      nextAction = steps.shift()
      currentParallel = nextAction(v)
      if (!isSync) {
        // eslint-disable-next-line no-use-before-define
        drainUntilEmptyOrAsync()
      }
    }

    function innerReject (e) {
      isRejected = true
      // eslint-disable-next-line no-use-before-define
      currentParallel = Parallel.reject(e)
    }

    function drainUntilEmptyOrAsync () {
      isSync = true
      while (isSync && steps.length > 0 && !isRejected) {
        currentParallelIsResolved = false
        currentParallel.fork(innerReject, innnerResolve)
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

  map (f) {
    return createSequence(this, (v) => Parallel.of(f(v)))
  }

  chain (f) {
    return createSequence(this, f)
  }

  ap (b) {
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

  map (f) {
    return new ResolvedParallel(f(this.value))
  }

}

class RejectedParallel extends Parallel {

  constructor (v) {
    super((reject) => reject(v))
    this.value = v
  }

  map () {
    return this
  }

  chain () {
    return this
  }

  ap () {
    return this
  }

}

Parallel.of = (v) => new ResolvedParallel(v)
Parallel.reject = (v) => new RejectedParallel(v)

export default Parallel
