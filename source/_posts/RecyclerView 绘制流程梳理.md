---
title: RecyclerView 绘制流程梳理
urlname: K9O0dOatwoqKLax1UUlc5Njonxg
date: '2025-04-26 15:15:59'
updated: '2025-04-26 15:16:56'
tags:
  - android
  - 八股
---
> 学安卓也好几年了，居然从来没有梳理过  
> 毕竟也算基本功 虽然感觉工作可能也用不太上了（
## onLayout
从 RecylcerView 的 onLayout 方法开始分析
![image](images/Ug9DbrycIooTvOxD7iHcbi1ynWe.png)
![image](images/L9HRbZ5Tioyov5xLzUWcfNMvn8f.png)
可以看到布局的操作被委托给了 adapter 和 layoutManager ，没设置的情况下会直接跳过布局。并且初次布局和后续数据更新重新布局所做的操作不同，初次布局执行 step1 和 step2，后续布局只执行 step2。

并且 recycler view 内部有一个布局流程的状态机
![image](images/ZC60bcNfXoOpRqxf1RZcRwJbn0c.json; charset=utf-8)
初始化状态
![image](images/LrfcbcemQoboo1xw1hFcBwYvnIb.json; charset=utf-8)
这里调用了 LayoutManager 的 onLayoutChildren 方法，我们选择 `LinearLayoutManager#onLayoutChildren` 进行分析
## LinearLayoutManager#onLayoutChildren
1. 找到之前的 anchor 位置 （如果有）

1. 先往正方向（即end的方向）填充 children 再往反方向填充 children
	- 可见部分是否还有剩余空间 && adapter 是否还有 item，如果是就一直 layoutChunk 直到不满足条件为止
		- extra 值也会算到 remainingSpace 里面，而 extra 其实就是 recyclerview 的 padding，也就是说 padding 所在区域也会用作渲染 item，但 margin 就不会。
	
![image](images/HSf6borOVoPlDPxmtRKcPPvpnfb.json; charset=utf-8)
![image](images/YE6Ab2jBro6nQjxFWjlc0KvTnZg.png)
![image](images/K233bvXxfooxM8xBW0DceH01npW.png)
## LinearLayoutManager#layoutChunk
layoutChunk 中使用 layoutState.next 获取了一个 view，实际上就是走 recyclerview 的四级缓存获取了一个 viewholder 上面的 view，而其中包含了 adapter 的 create bind 等各种逻辑（这段逻辑我们就后面分析了）。并且将这个 view 加入到 recyclerview 的 child 中，然后测量 child（item decoration 在这个时候也会跟 child 一起被测量）。
![image](images/Hn9ab8Q9yofVc5xrPnDcxgE6nWg.json; charset=utf-8)
![image](images/WrgRblCL8opubKxcMbXcsfVonXb.png)
下面是 recyclerview child 的 measure spec，哪个方向可以滚动则 canScroll 为 true。
![image](images/Gqa8bzuM3okC6cxgQVvcdaLrnIl.json; charset=utf-8)
measure 完新加入的 child 后开始计算 child 的 bounding box，并根据这个 bouding box 相对于 recyclerview 的 top bottom left right 来 layout child。
![image](images/QSzbbPlbeoutilxxeVcc5JZunUe.json; charset=utf-8)
![image](images/CI7HbKJA1o0pEXxpCiRcvVmrnad.json; charset=utf-8)
至此单个 item 便 layout 完毕了。
## 四级缓存 Recycler#getViewForPosition
- 从 changedScrap 中找，notifyItemChanged 会将 viewholder 放入 changedScrap

- 从 attached scrap 和 hidden view 和 mCachedView 里面找，也就是第一/第二层缓存
	- ChildHelper#addView 可以添加一个 hidden view，但 recycler view 的实现中没有用到，应该只是应对某些特殊情况
	
- 通过 stable id 从 mAttachedScrap 和 mCachedView 中找
	- Adapter#setHasStableIds 设置，可以通过 view id 获取 viewholder
	
- 从 ViewCacheExtension 获取，也就是第三层缓存

- 从 RecyclerPool 中获取

- 通过 Adapter#createViewHolder 进行创建

- 获取到 viewholder 后，如果需要 bind 则 bind

```undefined
@Nullable
ViewHolder tryGetViewHolderForPositionByDeadline(int position,
        boolean dryRun, long deadlineNs) {
    if (position < 0 || position >= mState.getItemCount()) {
        throw new IndexOutOfBoundsException("Invalid item position " + position
                + "(" + position + "). Item count:" + mState.getItemCount()
                + exceptionLabel());
    }
    boolean fromScrapOrHiddenOrCache = false;
    ViewHolder holder = null;
    // 0) If there is a changed scrap, try to find from there
    if (mState.isPreLayout()) {
        holder = getChangedScrapViewForPosition(position);
        fromScrapOrHiddenOrCache = holder != null;
    }
    // 1) Find by position from scrap/hidden list/cache
    if (holder == null) {
        holder = getScrapOrHiddenOrCachedHolderForPosition(position, dryRun);
        if (holder != null) {
            if (!validateViewHolderForOffsetPosition(holder)) {
                // recycle holder (and unscrap if relevant) since it can't be used
                if (!dryRun) {
                    // we would like to recycle this but need to make sure it is not used by
                    // animation logic etc.
                    holder.addFlags(ViewHolder.FLAG_INVALID);
                    if (holder.isScrap()) {
                        removeDetachedView(holder.itemView, false);
                        holder.unScrap();
                    } else if (holder.wasReturnedFromScrap()) {
                        holder.clearReturnedFromScrapFlag();
                    }
                    recycleViewHolderInternal(holder);
                }
                holder = null;
            } else {
                fromScrapOrHiddenOrCache = true;
            }
        }
    }
    if (holder == null) {
        final int offsetPosition = mAdapterHelper.findPositionOffset(position);
        if (offsetPosition < 0 || offsetPosition >= mAdapter.getItemCount()) {
            throw new IndexOutOfBoundsException("Inconsistency detected. Invalid item "
                    + "position " + position + "(offset:" + offsetPosition + ")."
                    + "state:" + mState.getItemCount() + exceptionLabel());
        }

        final int type = mAdapter.getItemViewType(offsetPosition);
        // 2) Find from scrap/cache via stable ids, if exists
        if (mAdapter.hasStableIds()) {
            holder = getScrapOrCachedViewForId(mAdapter.getItemId(offsetPosition),
                    type, dryRun);
            if (holder != null) {
                // update position
                holder.mPosition = offsetPosition;
                fromScrapOrHiddenOrCache = true;
            }
        }
        if (holder == null && mViewCacheExtension != null) {
            // We are NOT sending the offsetPosition because LayoutManager does not
            // know it.
            final View view = mViewCacheExtension
                    .getViewForPositionAndType(this, position, type);
            if (view != null) {
                holder = getChildViewHolder(view);
                if (holder == null) {
                    throw new IllegalArgumentException("getViewForPositionAndType returned"
                            + " a view which does not have a ViewHolder"
                            + exceptionLabel());
                } else if (holder.shouldIgnore()) {
                    throw new IllegalArgumentException("getViewForPositionAndType returned"
                            + " a view that is ignored. You must call stopIgnoring before"
                            + " returning this view." + exceptionLabel());
                }
            }
        }
        if (holder == null) { // fallback to pool
            if (DEBUG) {
                Log.d(TAG, "tryGetViewHolderForPositionByDeadline("
                        + position + ") fetching from shared pool");
            }
            holder = getRecycledViewPool().getRecycledView(type);
            if (holder != null) {
                holder.resetInternal();
                if (FORCE_INVALIDATE_DISPLAY_LIST) {
                    invalidateDisplayListInt(holder);
                }
            }
        }
        if (holder == null) {
            long start = getNanoTime();
            if (deadlineNs != FOREVER_NS
                    && !mRecyclerPool.willCreateInTime(type, start, deadlineNs)) {
                // abort - we have a deadline we can't meet
                return null;
            }
            holder = mAdapter.createViewHolder(RecyclerView.this, type);
            if (ALLOW_THREAD_GAP_WORK) {
                // only bother finding nested RV if prefetching
                RecyclerView innerView = findNestedRecyclerView(holder.itemView);
                if (innerView != null) {
                    holder.mNestedRecyclerView = new WeakReference<>(innerView);
                }
            }

            long end = getNanoTime();
            mRecyclerPool.factorInCreateTime(type, end - start);
            if (DEBUG) {
                Log.d(TAG, "tryGetViewHolderForPositionByDeadline created new ViewHolder");
            }
        }
    }

    // This is very ugly but the only place we can grab this information
    // before the View is rebound and returned to the LayoutManager for post layout ops.
    // We don't need this in pre-layout since the VH is not updated by the LM.
    if (fromScrapOrHiddenOrCache && !mState.isPreLayout() && holder
            .hasAnyOfTheFlags(ViewHolder.FLAG_BOUNCED_FROM_HIDDEN_LIST)) {
        holder.setFlags(0, ViewHolder.FLAG_BOUNCED_FROM_HIDDEN_LIST);
        if (mState.mRunSimpleAnimations) {
            int changeFlags = ItemAnimator
                    .buildAdapterChangeFlagsForAnimations(holder);
            changeFlags |= ItemAnimator.FLAG_APPEARED_IN_PRE_LAYOUT;
            final ItemHolderInfo info = mItemAnimator.recordPreLayoutInformation(mState,
                    holder, changeFlags, holder.getUnmodifiedPayloads());
            recordAnimationInfoIfBouncedHiddenView(holder, info);
        }
    }

    boolean bound = false;
    if (mState.isPreLayout() && holder.isBound()) {
        // do not update unless we absolutely have to.
        holder.mPreLayoutPosition = position;
    } else if (!holder.isBound() || holder.needsUpdate() || holder.isInvalid()) {
        if (DEBUG && holder.isRemoved()) {
            throw new IllegalStateException("Removed holder should be bound and it should"
                    + " come here only in pre-layout. Holder: " + holder
                    + exceptionLabel());
        }
        final int offsetPosition = mAdapterHelper.findPositionOffset(position);
        bound = tryBindViewHolderByDeadline(holder, offsetPosition, position, deadlineNs);
    }

    final ViewGroup.LayoutParams lp = holder.itemView.getLayoutParams();
    final LayoutParams rvLayoutParams;
    if (lp == null) {
        rvLayoutParams = (LayoutParams) generateDefaultLayoutParams();
        holder.itemView.setLayoutParams(rvLayoutParams);
    } else if (!checkLayoutParams(lp)) {
        rvLayoutParams = (LayoutParams) generateLayoutParams(lp);
        holder.itemView.setLayoutParams(rvLayoutParams);
    } else {
        rvLayoutParams = (LayoutParams) lp;
    }
    rvLayoutParams.mViewHolder = holder;
    rvLayoutParams.mPendingInvalidate = fromScrapOrHiddenOrCache && bound;
    return holder;
}
```
## 后记
笔者在分析过程中刻意忽略了一些动画相关的逻辑，只大致分析了 layout 的流程。
