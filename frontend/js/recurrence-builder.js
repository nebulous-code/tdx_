/* recurrence-builder.js — guided builder that writes recurrence syntax */
window.RecurrenceBuilder = {
  props: ['modelValue','anchor'],
  emits: ['update:modelValue'],
  template: `
  <div class="recbuilder">
    <!-- frequency selector -->
    <div class="chips" style="margin-bottom:8px;">
      <span class="chip" :class="{on: freq==='none'}" @click="setFreq('none')">none</span>
      <span class="chip" :class="{on: freq==='daily'}" @click="setFreq('daily')">daily</span>
      <span class="chip" :class="{on: freq==='weekly'}" @click="setFreq('weekly')">weekly</span>
      <span class="chip" :class="{on: freq==='monthly'}" @click="setFreq('monthly')">monthly</span>
    </div>

    <!-- DAILY -->
    <div v-if="freq==='daily'" class="bgroup" style="margin-bottom:8px;">
      <div class="bg-label">interval</div>
      <div class="chips" style="align-items:center;">
        <span class="mut">every</span>
        <input class="input" style="width:48px;text-align:center;" type="number" min="1" v-model.number="dInterval" @input="emit" />
        <span class="mut">day(s)</span>
      </div>
    </div>

    <!-- WEEKLY -->
    <div v-if="freq==='weekly'" style="margin-bottom:8px;">
      <div class="bgroup" style="margin-bottom:6px;">
        <div class="bg-label">on days</div>
        <div class="chips">
          <span v-for="(w,i) in WD" :key="i" class="chip" :class="{on: wDays.includes(i)}" @click="toggleDay(i)">{{ w }}</span>
        </div>
        <div class="chips" style="margin-top:4px;">
          <span class="chip" @click="preset([1,3,5])">MWF</span>
          <span class="chip" @click="preset([2,4])">Tu/Th</span>
          <span class="chip" @click="preset([6,0])">Sat/Sun</span>
          <span class="chip" @click="preset([1,2,3,4,5])">weekdays</span>
        </div>
      </div>
      <div class="bgroup">
        <div class="bg-label">repeat</div>
        <div class="chips" style="align-items:center;">
          <span class="mut">every</span>
          <input class="input" style="width:48px;text-align:center;" type="number" min="1" v-model.number="wInterval" @input="emit" />
          <span class="mut">week(s)</span>
        </div>
      </div>
    </div>

    <!-- MONTHLY -->
    <div v-if="freq==='monthly'" style="margin-bottom:8px;">
      <div class="chips" style="margin-bottom:6px;">
        <span class="chip" :class="{on: mMode==='day'}" @click="mMode='day';emit()">on a date</span>
        <span class="chip" :class="{on: mMode==='weekday'}" @click="mMode='weekday';emit()">on a weekday</span>
      </div>
      <div v-if="mMode==='day'" class="chips" style="align-items:center;margin-bottom:6px;">
        <span class="mut">on day</span>
        <input class="input" style="width:52px;text-align:center;" type="number" min="1" max="31" v-model.number="mDay" @input="emit" />
      </div>
      <div v-if="mMode==='weekday'" class="chips" style="align-items:center;margin-bottom:6px;">
        <span class="mut">on the</span>
        <select class="input" style="width:auto;" v-model="mOrd" @change="emit">
          <option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option>
          <option value="4">4th</option><option value="-1">last</option>
        </select>
        <select class="input" style="width:auto;" v-model.number="mWeekday" @change="emit">
          <option v-for="(w,i) in WDfull" :key="i" :value="i">{{ w }}</option>
        </select>
      </div>
      <div class="bgroup">
        <div class="bg-label">repeat</div>
        <div class="chips" style="align-items:center;">
          <span class="mut">every</span>
          <input class="input" style="width:48px;text-align:center;" type="number" min="1" v-model.number="mInterval" @input="emit" />
          <span class="mut">month(s)</span>
        </div>
      </div>
    </div>

    <!-- syntax (editable) + preview -->
    <div v-if="freq!=='none'" class="field" style="margin-bottom:6px;">
      <label>syntax <span class="mut">— editable, reusable</span></label>
      <input class="input cy" v-model="raw" @input="onRaw" @blur="syncFromRaw" placeholder="e.g. every 2 weeks on mon,wed" />
    </div>
    <div v-if="freq!=='none'" class="rec-summary">
      ↻ {{ summary }}
    </div>
    <div v-if="freq!=='none' && preview.length" class="rec-preview">
      next: <b>{{ preview.join('  ·  ') }}</b>
    </div>
    <div v-if="freq!=='none' && !preview.length" class="rec-preview rd">⚠ pattern doesn't resolve — check syntax</div>
  </div>
  `,
  data(){
    return {
      freq:'none',
      raw:'',
      dInterval:1,
      wDays:[1], wInterval:1,
      mMode:'day', mDay:1, mOrd:'1', mWeekday:1, mInterval:1,
      WD: Rec.WD.map(w=>w), // sun..sat
      WDfull: Rec.WD_FULL,
    };
  },
  computed: {
    summary(){ return this.raw ? Rec.summary(this.raw) : ''; },
    preview(){
      if(!this.raw) return [];
      const occ = Rec.nextOccurrences(this.raw, { anchor:this.anchor||undefined, from:this.anchor||undefined, count:3, inclusive:false });
      return occ.map(d=>Rec.ymd(d).slice(5));
    }
  },
  watch: {
    modelValue(v){ if(v !== this.raw) this.loadFrom(v); }
  },
  mounted(){ this.loadFrom(this.modelValue); },
  methods: {
    loadFrom(str){
      this.raw = str || '';
      if(!str){ this.freq='none'; return; }
      const r = Rec.parse(str);
      if(!r || r.type==='invalid'){ return; }
      if(r.type==='daily'){ this.freq='daily'; this.dInterval=r.interval; }
      else if(r.type==='weekly'){ this.freq='weekly'; this.wDays=(r.days&&r.days.length)?[...r.days]:[1]; this.wInterval=r.interval; }
      else if(r.type==='monthly-day'){ this.freq='monthly'; this.mMode='day'; this.mDay=r.day||1; this.mInterval=r.interval; }
      else if(r.type==='monthly-weekday'){ this.freq='monthly'; this.mMode='weekday'; this.mOrd=String(r.ord); this.mWeekday=r.weekday; this.mInterval=r.interval; }
    },
    setFreq(f){
      this.freq=f;
      if(f==='none'){ this.raw=''; this.$emit('update:modelValue',''); return; }
      this.emit();
    },
    toggleDay(i){
      const idx=this.wDays.indexOf(i);
      if(idx>=0) this.wDays.splice(idx,1); else this.wDays.push(i);
      this.wDays.sort((a,b)=>a-b);
      if(!this.wDays.length) this.wDays=[i];
      this.emit();
    },
    preset(days){ this.wDays=[...days].sort((a,b)=>a-b); this.emit(); },
    build(){
      let r=null;
      if(this.freq==='daily') r={type:'daily', interval:Math.max(1,this.dInterval||1)};
      else if(this.freq==='weekly') r={type:'weekly', interval:Math.max(1,this.wInterval||1), days:this.wDays.length?this.wDays:[1]};
      else if(this.freq==='monthly'){
        if(this.mMode==='day') r={type:'monthly-day', interval:Math.max(1,this.mInterval||1), day:Math.min(31,Math.max(1,this.mDay||1))};
        else r={type:'monthly-weekday', interval:Math.max(1,this.mInterval||1), ord:parseInt(this.mOrd), weekday:this.mWeekday};
      }
      return r ? Rec.stringify(r) : '';
    },
    emit(){
      this.$nextTick(()=>{
        this.raw = this.build();
        this.$emit('update:modelValue', this.raw);
      });
    },
    onRaw(){ this.$emit('update:modelValue', this.raw); },
    syncFromRaw(){ this.loadFrom(this.raw); }
  }
};
